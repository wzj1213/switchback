import type { Command, Item, Thread } from "@omni/protocol"
import { buildHandoff, renderHandoff } from "@omni/handoff"
import { initial, itemsOf, reduceAll } from "@omni/store"
import { emit, type Ctx, type Live } from "./ctx.js"
import { launch, rememberHandle } from "./session.js"
import { prompt } from "./prompt.js"

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

  const asks = packet.asks.length === 0 ? "" : `\n\n过程中追加过的要求：\n${packet.asks.map((a) => `- ${a}`).join("\n")}`
  await prompt(
    ctx,
    { type: "thread.prompt", threadId: thread.id, text: `${packet.goal}${asks}` },
    "handoff",
  )
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
 * 把上下文抄进新会话的 transcript。
 *
 * 引擎那边已经什么都记得（原生 fork 复制的是真的会话），但 omni 的记录是
 * **按会话分文件存的**——不抄的话你看到的是一个空对话，而它其实记得一切。
 * 「看起来丢了但其实没丢」比真丢了更难受：你会把已经说过的话再说一遍。
 *
 * ## turn id 必须重新铸
 *
 * journal 按 `turnOwner` 分文件。沿用旧的 turn id，抄过来的记录会被写进
 * **原会话**的文件里——两条会话从此互相污染，而且是静默的。
 * item id 一起重铸：反正 store 是按会话分表存的，重铸不花什么代价。
 *
 * 每一轮都补一条 `turn.completed`，否则界面上它们永远停在「正在跑」。
 */
function copyTranscript(ctx: Ctx, thread: Thread, items: readonly Item[]): void {
  const minted = new Map<string, string>()
  for (const item of items) {
    let turnId = minted.get(item.turnId)
    if (turnId === undefined) {
      turnId = ctx.deps.newId("tn")
      minted.set(item.turnId, turnId)
      ctx.turnOwner.set(turnId, thread.id)
      emit(ctx, {
        type: "turn.started",
        at: item.at,
        turn: { id: turnId, threadId: thread.id, engine: thread.engine, status: "running", startedAt: item.at },
      })
    }
    emit(ctx, { type: "item.started", at: item.at, item: { ...item, id: ctx.deps.newId("it"), turnId } })
  }
  const last = items[items.length - 1]?.at ?? ctx.deps.now()
  for (const turnId of minted.values()) {
    emit(ctx, { type: "turn.completed", at: last, turnId, status: "completed" })
  }
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
  const thread: Thread = {
    ...entry.thread,
    engine: cmd.to,
    engineHistory: [...entry.thread.engineHistory, cmd.to],
    // 换了引擎，上一家的会话句柄就没用了——留着会在续跑时拿它去问新的一家
    engineHandle: undefined,
    model: undefined,
    effort: undefined,
    status: "idle",
    updatedAt: at,
  }
  const early = await launch(ctx, thread)
  emit(ctx, { type: "thread.updated", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)

  // 交接包作为第一条消息发出去，**并且进 transcript**——
  // 用户要看得见接手的一家究竟被告知了什么
  await prompt(
    ctx,
    { type: "thread.prompt", threadId: cmd.threadId, text: renderHandoff(packet, from, cmd.to) },
    "handoff",
  )
}
