import type { Command, EngineSegment, Item, Thread, ThreadId } from "@omni/protocol"
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

  // 原生分叉成功时把 transcript 抄过来：**引擎那边已经什么都知道了**，
  // 人看到的和它记得的就对上了
  if (forked !== undefined) copyTranscript(ctx, thread, items)
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
export function handoff(ctx: Ctx, cmd: Extract<Command, { type: "thread.handoff" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  if (ctx.deps.drivers[cmd.to] === undefined) throw new Error(`未注册的引擎：${cmd.to}`)

  /**
   * **临时会话当场切**（见 `Thread.provisional`）。
   *
   * 「下一句生效」那套是为**开过工的会话**定的：它有正在跑的活、有一段要保住的
   * 上下文，点错一下的代价很大。临时会话一样都没有——它还什么都没说。
   * 而推迟在它身上有个实打实的代价：**模型清单是引擎起来之后才报的**，
   * 不当场切就等于「你必须先说一句话，才能挑这一句用哪个模型」。
   */
  if (entry.thread.provisional === true) return switchEngine(ctx, cmd.threadId, cmd.to)

  const at = ctx.deps.now()
  const next = { ...entry.thread, updatedAt: at }
  // 选回当前这家 = 取消待切换
  if (cmd.to === entry.thread.engine) delete next.nextEngine
  else next.nextEngine = cmd.to
  entry.thread = next
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  // **记一笔意向而已，没有 IO**。签名是 Promise 只为了对上 `host.ts` 的分派表
  return Promise.resolve()
}

/**
 * 真正把引擎换掉。两个调用点，对应两种会话：
 *
 * - **开过工的会话**：由 `prompt` 在发出下一句话时调用，不是用户点下拉的那一刻
 *   （理由见 `Thread.nextEngine`）
 * - **临时会话**：`handoff` 直接调用，点下拉当场就换（理由同上）
 *
 * 换过去之后：起新进程、停旧的、清掉模型与强度（上一家的模型 id 在新的一家
 * 那里通常根本不存在）、`nextEngine` 清空。
 *
 * **不传原始上下文，也不塞任何文本。** 各家 session 格式不通，硬翻既做不对也
 * 维护不起；而 omni 替用户编一段摘要塞进输入框更糟——那是他没打过的话。
 * 上一家的原始记录路径 omni 已经存在 `Thread.segments` 里（`/timeline` 看得见），
 * 新的一家自己有文件工具，要读的时候读全量原文。
 */
export async function switchEngine(ctx: Ctx, threadId: ThreadId, to: string): Promise<void> {
  const entry = ctx.live.get(threadId)
  if (entry === undefined) throw new Error(`会话不存在：${threadId}`)
  if (entry.thread.engine === to) return
  if (ctx.deps.drivers[to] === undefined) throw new Error(`未注册的引擎：${to}`)

  const at = ctx.deps.now()
  // **切回去要续上那一家自己的那条**，不是新开一条。
  //
  // 上一版把 `engineHandle` 清成 undefined（「换了引擎，上一家的句柄就没用了」），
  // 于是：codex 跑了一半，切去 Claude 看一眼，再切回来时 codex 已经不记得
  // 自己做过什么了。而每一家的句柄本来就各存各的（`segments`），
  // 切回来查一下就有。
  const back = (entry.thread.segments ?? []).find((seg) => seg.engine === to)
  const thread = switched(entry.thread, to, back, at)
  // **先把旧条目摘下来再起新的**：驱动可能在 `start()` 里就回调 `onHandle`，
  // 那时表里若还留着旧条目，新句柄会写到**旧那条**上，然后被覆盖丢掉
  entry.gate.settleAll()
  ctx.live.delete(threadId)
  const early = await launch(ctx, thread, back?.handle).catch((error: unknown) => {
    // **起不来就原样退回。** 旧那条这时还活着（下面那行 dispose 还没跑到），
    // 挂回去就当无事发生——一条会话不该因为「想试试另一家」而报废
    ctx.live.set(threadId, entry)
    throw error
  })
  /**
   * **新的起来了才停旧的。**
   *
   * 上一版反过来（先 dispose 再 launch），理由是「两个引擎同时对着一个工作区写
   * 是最难查的一类冲突」。那个顾虑在这里不成立：切换只发生在**没有轮次在跑**
   * 的时候（`prompt` 里那条判断、以及还没说过话的临时会话），旧那条是空闲的，
   * 而且这里立刻就把它停掉，重叠只有握手那几百毫秒、双方都不动手。
   *
   * 而那个顺序有个真代价：新那家起不来（没装、没登录、版本不对）时，
   * 旧进程已经没了、新的又没起来，**那条会话从此发不出任何一句话**，
   * 界面上还看不出为什么。用引擎下拉里那个「未安装」的选项就能复现。
   */
  await entry.session.dispose().catch(() => undefined)
  // **发 `live` 里那一份，不是这个局部变量**——`launch` 会往上面挂新那家的
  // 引擎能力。发局部的那份等于把**旧那家的能力**留在界面上：换过去之后
  // 贴图入口、改向提示照着上一家画，而且一声不响（`create` 那边踩过同一个坑）
  emit(ctx, { type: "thread.updated", at, thread: ctx.live.get(threadId)?.thread ?? thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
}

/**
 * 换过引擎之后这条会话长什么样。
 *
 * **模型和强度清掉**：它们跟着引擎走，上一家的模型 id 在新的一家那里
 * 通常根本不存在。清单同理——渲染层认「这份是谁报的」（见 store 的 `modelsOf`），
 * 新那家报上来之前，选择器上什么都不摆。
 */
function switched(prev: Thread, to: string, back: EngineSegment | undefined, at: number): Thread {
  const next: Thread = {
    ...prev,
    engine: to,
    // 临时会话在旧那家**什么都没发生过**，历史里不该留一笔——
    // 点开下拉挑了三次就记三条的话，`/timeline` 会被「我点错了」填满
    engineHistory: prev.provisional === true ? [to] : [...prev.engineHistory, to],
    ...(back === undefined ? { engineHandle: undefined } : { engineHandle: back.handle }),
    model: undefined,
    effort: undefined,
    status: "idle",
    updatedAt: at,
  }
  delete next.nextEngine
  return next
}



