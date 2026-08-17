import type { Command, Item, Thread, ThreadId } from "@omni/protocol"
import { buildHandoff, renderHandoff } from "@omni/handoff"
import { initial, itemsOf, reduceAll } from "@omni/store"
import { emit, type Ctx, type Live } from "./ctx.js"
import { copyTranscript } from "./transcript.js"
import { launch, rememberHandle } from "./session.js"

/**
 * 从一条会话岔出另一条：分叉（换引擎）、重来（砍掉后面几轮）、接力（换引擎但不留旧的）。
 *
 * 三者共用一套「把上下文交给下一家」的逻辑，所以住在一个文件里。
 * 交给下一家有两条路，选哪条只看一件事——**是不是同一家引擎**：
 *
 * - 同一家：让它自己复制会话（`session.fork`），上下文一点不少
 * - 换一家：交接包。各家会话格式不通，硬翻既做不对也维护不起，
 *   所以只传从 transcript 提炼出的目标与追加要求
 */

/**
 * 从某一轮之前重来。
 *
 * 实现上是**只带前面若干轮的分叉**——同一家引擎、同一个工作区，原会话不动。
 *
 * 和 `fork` 共用一条路：两者的区别只有「换不换引擎」和「带多少上下文」，
 * 分成两套实现的话，将来改分叉方式就要改两处，而漏改的那处不会报错。
 */
export async function rewind(ctx: Ctx, cmd: Extract<Command, { type: "thread.rewind" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  await branch(ctx, entry, { to: entry.thread.engine, upTo: cmd.turnId, label: "重来" })
}

export async function fork(ctx: Ctx, cmd: Extract<Command, { type: "thread.fork" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  await branch(ctx, entry, { to: cmd.to, label: cmd.to })
}

/**
 * 从一个会话岔出一条新的。分叉（换引擎）与重来（砍掉后面几轮）共用这条路。
 *
 * @param upTo 只带这一轮**之前**的内容。不给就是全部。
 */
async function branch(
  ctx: Ctx,
  entry: Live,
  opts: { to: string; upTo?: string; label: string },
): Promise<void> {
  if (ctx.deps.drivers[opts.to] === undefined) throw new Error(`未注册的引擎：${opts.to}`)

  const events = (await ctx.deps.journal?.read(entry.thread.id)) ?? []
  const all = itemsOf(reduceAll(initial(), events), entry.thread.id)
  const items = opts.upTo === undefined ? all : until(all, opts.upTo)
  const packet = buildHandoff(entry.thread, items)
  const plan = forkPlan(entry, opts.to, all, items)

  const at = ctx.deps.now()
  const thread: Thread = {
    ...entry.thread,
    id: ctx.deps.newId("th"),
    engine: opts.to,
    engineHistory: [opts.to],
    // 分叉出来的句柄由驱动在握手时回调上来（`onHandle`），这里先清空：
    // 留着原会话的句柄，续跑时会拿它去问引擎，接回的是**原会话**
    engineHandle: undefined,
    model: undefined,
    effort: undefined,
    // 标题带上来路，否则侧栏里两个会话长得一模一样
    title: `${entry.thread.title}（${opts.label}）`,
    // 留下血缘，事后才对比得起来。**分叉的意义就在于能比**
    forkedFrom: entry.thread.id,
    detached: false,
    status: "idle",
    createdAt: at,
    updatedAt: at,
    queued: [],
  }
  const forked = plan === undefined ? undefined : await tryFork(ctx, thread, plan)
  const early = forked?.early ?? (forked === undefined ? await launch(ctx, thread) : undefined)
  emit(ctx, { type: "thread.started", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)

  if (forked !== undefined) {
    // **引擎那边已经什么都知道了**，不用再发交接包——发了反而是把它已经
    // 亲历过的事再复述一遍。只要把 transcript 抄过来，人看到的和它记得的就对上了
    copyTranscript(ctx, thread, items)
    return
  }

  // **不替用户发出去。** 交接包是 omni 替他写的一段话——直接发等于
  // 「分叉一份」变成「分叉一份并且立刻开跑」，而且那条他没打过的话
  // 会以他的名义进 transcript、立刻花掉一轮额度。挂成草稿，他看得见、能改
  draftInto(ctx, thread.id, handoffText(packet))
}

/**
 * 取这一轮**之前**的 item。
 *
 * 边界是「不含这一轮」：用户点「从这里重来」，指的是**回到还没发生这一轮的时候**，
 * 而不是「再看一遍这一轮」。含进去的话，新会话开局就带着那次走错的尝试。
 */
function until(items: readonly Item[], turnId: string): readonly Item[] {
  const at = items.findIndex((item) => item.turnId === turnId)
  return at === -1 ? items : items.slice(0, at)
}

/**
 * 试着让引擎自己复制一份会话，返回它那边的新句柄。**不行就返回 undefined**，
 * 调用方退回交接包。
 *
 * ## 为什么值得多这一条路
 *
 * 交接包是从 transcript 里提炼出来的一句目标加几条追加要求。跨引擎时它是
 * **唯一**可能的做法，但同一家引擎内部这么做是自伤：分出来那条会话
 * 对「读过哪些文件、写过什么、撞过什么错」一无所知。
 * 一个叫「重来」的功能，实际是从零开始——而界面上看不出区别。
 *
 * codex 的 `thread/fork` 复制的是真的会话。
 *
 * ## 失败为什么只是退回，不是报错
 *
 * 交接包那条路一直都在，而且一直够用。原生分叉是**更好**，不是**必需**——
 * 为了它把一个能用的功能变成一个会报错的功能，是把好的换成差的。
 */
function forkPlan(
  entry: Live,
  to: string,
  all: readonly Item[],
  keep: readonly Item[],
): { handle: string; dropTurns?: number } | undefined {
  // 跨引擎时会话格式不通，交接包是唯一的路
  if (to !== entry.thread.engine) return undefined
  if (entry.thread.capabilities?.fork !== true) return undefined
  const handle = entry.thread.engineHandle
  // 还没拿到引擎侧句柄的会话分不了叉——那通常意味着它还没真正跑过任何一轮
  if (handle === undefined) return undefined
  const dropTurns = turnsAfter(all, keep)
  return { handle, ...(dropTurns === 0 ? {} : { dropTurns }) }
}

/**
 * 以分叉的方式把新会话起起来。**起不来就返回 undefined**，调用方退回交接包。
 *
 * 分叉由**新会话自己的引擎进程**做（见 `StartRequest.forkOf`），所以这里
 * 只能整条 launch 一次；失败时 `ctx.live` 里什么都没登记，重来一次是干净的。
 */
async function tryFork(
  ctx: Ctx,
  thread: Thread,
  plan: { handle: string; dropTurns?: number },
): Promise<{ early: string | undefined } | undefined> {
  try {
    return { early: await launch(ctx, thread, undefined, plan) }
  } catch {
    return undefined
  }
}

/** 要从末尾丢掉几轮：全部轮次数 减去 留下的轮次数。 */
function turnsAfter(all: readonly Item[], keep: readonly Item[]): number {
  const total = new Set(all.map((i) => i.turnId)).size
  return Math.max(0, total - new Set(keep.map((i) => i.turnId)).size)
}


/**
 * L2 跨引擎接力：同一个会话换一家引擎接着做。
 *
 * **不传原始上下文**——各家 session 格式不通，硬翻既做不对也维护不起。
 * 传的是从 transcript 里提炼出来的**交接包**（见 `@omni/handoff`）。
 *
 * transcript 在渲染层的 store 里，宿主手上没有。但宿主有日志——
 * 把事件回放一遍过同一个归约器就得到同一份 items。
 * **这正是「事件流是真源、归约器是纯函数」这条设计换来的**：
 * 不需要为宿主再维护一份 transcript 副本，也就不会出现两份对不上。
 */
export async function handoff(ctx: Ctx, cmd: Extract<Command, { type: "thread.handoff" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  if (entry.thread.engine === cmd.to) return
  if (ctx.deps.drivers[cmd.to] === undefined) throw new Error(`未注册的引擎：${cmd.to}`)

  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const from = entry.thread.engine
  const packet = buildHandoff(entry.thread, itemsOf(reduceAll(initial(), events), cmd.threadId))

  // 先停旧的再起新的：两个引擎同时对着一个工作区写，是最难查的一类冲突
  entry.gate.settleAll()
  await entry.session.dispose()
  ctx.live.delete(cmd.threadId)

  const at = ctx.deps.now()
  // **切回去要续上那一家自己的那条**，不是新开一条。
  //
  // 上一版把 `engineHandle` 清成 undefined（「换了引擎，上一家的句柄就没用了」），
  // 于是：codex 跑了一半，切去 Claude 看一眼，再切回来时 codex 已经不记得
  // 自己做过什么了。而每一家的句柄本来就各存各的（`segments`），
  // 切回来查一下就有。
  const back = (entry.thread.segments ?? []).find((seg) => seg.engine === cmd.to)
  const thread: Thread = {
    ...entry.thread,
    engine: cmd.to,
    engineHistory: [...entry.thread.engineHistory, cmd.to],
    ...(back === undefined ? { engineHandle: undefined } : { engineHandle: back.handle }),
    // 模型和强度是**跟着引擎走**的，换一家就得重新问——上一家的模型 id
    // 在新的一家那里通常根本不存在
    model: undefined,
    effort: undefined,
    status: "idle",
    updatedAt: at,
  }
  const early = await launch(ctx, thread, back?.handle)
  emit(ctx, { type: "thread.updated", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)

  // **不替用户发，也不再替他编一段摘要。** 给的是上一家的原始记录在哪——
  // 新的一家自己有文件工具，你让它 review 它就去读，读到的是全量原文。
  // 拿不到路径时（比如 ACP 那类协议里没这个概念）才退回交接包
  draftInto(ctx, cmd.threadId, pointerOr(entry.thread, from, cmd.to, () => renderHandoff(packet, from, cmd.to)))
}

/**
 * 换引擎时放进输入框的那句话。
 *
 * **优先给路径，不给摘要。** 上一家的原始记录就在磁盘上，而这些引擎都会读文件——
 * 与其由 omni 提炼一份必然丢东西的摘要塞给新的一家，不如告诉它记录在哪：
 * 你让它 review 时它自己去读**全量原文**，不问就不读，一个 token 都不浪费。
 *
 * 只有在**一条路径都拿不到**时才退回交接包（`fallback`）——那时没有别的办法
 * 把上下文带过去。
 */
function pointerOr(thread: Thread, from: string, to: string, fallback: () => string): string {
  const logs = (thread.segments ?? []).filter((seg) => seg.logPath !== undefined)
  if (logs.length === 0) return fallback()
  const lines = logs.map((seg) => `- ${seg.engine}：${seg.logPath ?? ""}`).join("\n")
  return `（这条会话之前由 ${from} 跑过，现在换成了 ${to}。上一段的完整记录在本地：\n${lines}\n需要的话你可以直接读它，比如让我 review 前面的改动。）\n\n`
}

/** 交接包的正文。目标 + 过程中追加过的要求。 */
function handoffText(packet: { goal: string; asks: readonly string[] }): string {
  const asks =
    packet.asks.length === 0 ? "" : `\n\n过程中追加过的要求：\n${packet.asks.map((a) => `- ${a}`).join("\n")}`
  return `${packet.goal}${asks}`
}

/**
 * 把一段话挂成这条会话的草稿。**不发出去**。
 *
 * 走 `thread.updated` 而不是另开一种事件：草稿要跟着会话一起落盘——
 * 一段没发出去的交接包，重启之后还该在输入框里等着。
 */
function draftInto(ctx: Ctx, threadId: ThreadId, text: string): void {
  const entry = ctx.live.get(threadId)
  if (entry === undefined || text.trim() === "") return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, draft: text, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}
