import type { Command, EngineSegment, Event, Item, Thread, ThreadId } from "@omni/protocol"
import { initial, itemsOf, reduceAll } from "@omni/store"
import { discardUnstarted, drainQueued, emit, isCurrent, withQueue, type Ctx, type Live } from "./ctx.js"
import { bornOf } from "./born.js"
import { copyTranscript } from "./transcript.js"
import { dropTemps, launch } from "./session.js"
import { rememberHandle } from "./engine-state.js"
import { carryRules } from "./approval.js"

/**
 * 从一条会话岔出另一条：分叉（换引擎）、重来（砍掉后面几轮）、接力（换引擎但不留旧的）。
 *
 * 三者共用一套「把上下文交给下一家」的逻辑，所以住在一个文件里。
 * 交给下一家有两条路，选哪条只看一件事——**是不是同一家引擎**：
 *
 * - 同一家且支持原生 fork：让引擎自己复制会话，上下文一点不少
 * - 换一家或不支持 fork：只开一条同工作区的空白分支，不替用户注入任何文本
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
  await branch(ctx, entry, {
    to: entry.thread.engine,
    upTo: cmd.turnId,
    label: "重来",
    // 「改一改再发」：回到那一轮之前，并把原话交还到新会话的输入框里
    ...(cmd.draft === undefined
      ? {}
      : { draft: { text: cmd.draft, attachments: cmd.draftAttachments } }),
  })
}

export async function fork(ctx: Ctx, cmd: Extract<Command, { type: "thread.fork" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  await branch(ctx, entry, { to: cmd.to, label: cmd.to })
}

async function stableEvents(ctx: Ctx, entry: Live, to: string): Promise<readonly Event[]> {
  if (entry.turn !== undefined) throw new Error("当前轮次尚未结束，不能分叉或从历史轮次重来")
  if (ctx.deps.drivers[to] === undefined) throw new Error(`未注册的引擎：${to}`)
  // 原生分叉在发出第一句前仍是临时会话，它可见的继承转录只在待提交缓冲里。
  // 此时再分一次若只读 journal，会得到空历史：引擎记得，界面却什么都没有。
  const pending = ctx.uncommitted.get(entry.thread.id)
  if (pending !== undefined) return [...pending]
  // 事件出口不等待 journal；刚收工就分叉时，先把最后几条完整落下再读。
  await ctx.deps.journal?.flush()
  return (await ctx.deps.journal?.read(entry.thread.id)) ?? []
}

/**
 * 从一个会话岔出一条新的。分叉（换引擎）与重来（砍掉后面几轮）共用这条路。
 *
 * @param upTo 只带这一轮**之前**的内容。不给就是全部。
 */
async function branch(
  ctx: Ctx,
  entry: Live,
  opts: {
    to: string
    upTo?: string
    label: string
    /** 岔出来之后放进输入框的话。见 `thread.rewind` 的 `draft`。 */
    draft?: { text: string; attachments?: readonly string[] }
  },
): Promise<void> {
  const events = await stableEvents(ctx, entry, opts.to)
  const all = itemsOf(reduceAll(initial(), events), entry.thread.id)
  const items = opts.upTo === undefined ? all : until(all, opts.upTo)
  const plan = forkPlan(entry, opts.to, all, items)
  if (opts.upTo !== undefined && plan === undefined) {
    throw new Error(`${entry.thread.engine} 当前不能带着原生上下文从这一轮重来`)
  }
  const at = ctx.deps.now()
  const thread = bornOf(ctx, entry, {
    to: opts.to,
    label: opts.label,
    kept: items.length,
    at,
    ...(opts.draft === undefined ? {} : { draft: opts.draft }),
  })
  // **先挂进待提交表再发事件**，理由同 `session.ts` 的新建：没说过话就不落盘。
  // 抄过来的 transcript 也在这份缓冲里，第一句话一发就按原序一起写下去
  ctx.uncommitted.set(thread.id, [])
  // 引擎可能在 start() 内就上报状态；出生事件必须排在所有这类回调前面，
  // 否则首次提交后的 journal 会变成“先有状态，后有会话”。
  emit(ctx, { type: "thread.started", at, thread: { ...thread, status: "starting" } })
  let launched: Awaited<ReturnType<typeof launchDerived>>
  try {
    launched = await launchDerived(ctx, thread, { ...(plan === undefined ? {} : { plan }), allowBlank: opts.upTo === undefined, items })
  } catch (error) {
    // 后一条临时会话已经取代这条尚未出生的分叉，是正常取消，不冒伪失败横幅。
    if (ctx.removed.has(thread.id)) return
    emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: thread.id })
    throw error
  }
  const { early } = launched
  // launch 已经挂上新引擎能力；用更新事件把 starting 壳落成可用会话。
  const current = ctx.live.get(thread.id)
  const status = derivedStatus(current)
  const born = { ...(current?.thread ?? thread), status, updatedAt: ctx.deps.now() }
  if (current !== undefined) current.thread = born
  emit(ctx, { type: "thread.updated", at: born.updatedAt, thread: born })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)

  // 原生分叉成功时把 transcript 抄过来：**引擎那边已经什么都知道了**，
  // 人看到的和它记得的就对上了
  drainQueued(ctx, current)
  /**
   * 把**别的**没用过的临时会话收掉。两个都不能收：
   *
   * - 刚分出来的这条（`thread.id`）——它正是用户要去的地方
   * - **来路那条**（`entry.thread.id`）——从一个临时会话分叉是合法的
   *   （比如刚开的空会话上点「换一家试试」），把来路收掉等于把人脚下的地板抽走
   */
  await dropTemps(ctx, [thread.id, entry.thread.id])
}

function derivedStatus(current: Live | undefined): "idle" | "running" {
  return current?.turn === undefined ? "idle" : "running"
}

/**
 * 取这一轮**之前**的 item。
 *
 * 边界是「不含这一轮」：用户点「从这里重来」，指的是**回到还没发生这一轮的时候**，
 * 而不是「再看一遍这一轮」。含进去的话，新会话开局就带着那次走错的尝试。
 */
function until(items: readonly Item[], turnId: string): readonly Item[] {
  const at = items.findIndex((item) => item.turnId === turnId)
  if (at === -1) throw new Error(`找不到要重来的历史轮次：${turnId}`)
  return items.slice(0, at)
}

/**
 * 试着让引擎自己复制一份会话。普通分叉失败时可以退回空白分支；
 * “从这里重来”不能退，因为它承诺保留指定轮次之前的上下文。
 *
 * ## 为什么值得多这一条路
 *
 * 同一家引擎内部开空白会话会丢掉「读过哪些文件、写过什么、撞过什么错」。
 * 对普通分叉，空白分支仍是一个诚实可见的结果；对“重来”，这会违背动作本身。
 *
 * codex 的 `thread/fork` 复制的是真的会话。
 *
 * ## 失败为什么只是退回，不是报错
 *
 * 跨引擎会话格式不通，omni 不翻译、不摘要，也不替用户发话；只保留工作区与血缘。
 */
interface NativeForkPlan { handle: string; dropTurns?: number }
interface DerivedLaunchPlan {
  plan?: NativeForkPlan
  allowBlank: boolean
  items: readonly Item[]
}
interface NativeDerivedLaunchPlan extends DerivedLaunchPlan { plan: NativeForkPlan }

function forkPlan(
  entry: Live,
  to: string,
  all: readonly Item[],
  keep: readonly Item[],
): NativeForkPlan | undefined {
  // 跨引擎时会话格式不通，只能开空白分支；不能冒充原生上下文复制。
  if (to !== entry.thread.engine) return undefined
  if (entry.thread.capabilities?.fork !== true) return undefined
  const handle = entry.thread.engineHandle
  // 还没拿到引擎侧句柄的会话分不了叉——那通常意味着它还没真正跑过任何一轮
  if (handle === undefined) return undefined
  const dropTurns = turnsAfter(all, keep)
  return { handle, ...(dropTurns === 0 ? {} : { dropTurns }) }
}

/**
 * 以原生分叉方式把新会话起起来。普通分叉允许失败后改开空白分支；重来不允许。
 *
 * 分叉由**新会话自己的引擎进程**做（见 `StartRequest.forkOf`），所以这里
 * 只能整条 launch 一次；失败时 `ctx.live` 里什么都没登记，重来一次是干净的。
 */
async function tryFork(
  ctx: Ctx,
  thread: Thread,
  options: NativeDerivedLaunchPlan,
): Promise<{ early: string | undefined } | undefined> {
  const { plan, allowBlank, items } = options
  const prepared = { value: false }
  try {
    return {
      early: await launch(ctx, thread, {
        forkOf: plan,
        beforeActivate: () => {
          prepared.value = true
          copyTranscript(ctx, thread, items)
        },
      }),
    }
  } catch (error) {
    if (prepared.value || ctx.closed || ctx.removed.has(thread.id) || !allowBlank) throw error
    return undefined
  }
}

async function launchDerived(
  ctx: Ctx,
  thread: Thread,
  options: DerivedLaunchPlan,
): Promise<{ forked: { early: string | undefined } | undefined; early: string | undefined }> {
  const { plan, allowBlank, items } = options
  try {
    const forked = plan === undefined
      ? undefined
      : await tryFork(ctx, thread, { plan, allowBlank, items })
    const early = forked?.early ?? (forked === undefined ? await launch(ctx, thread) : undefined)
    return { forked, early }
  } catch (error) {
    await discardUnstarted(ctx, thread.id)
    throw error
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
 * **不传原始上下文，也不注入摘要或提示词**——各家 session 格式不通，
 * omni 不能替用户翻译，更不能以用户身份发一段他没写过的话。
 * 引擎公开可定位的原生记录路径保留在 `Thread.segments`，需要时由用户明确让引擎读取。
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

async function replacement(
  ctx: Ctx,
  entry: Live,
  thread: Thread,
  previous: Thread,
): Promise<string | undefined> {
  try {
    // 同一 thread 的接力只复用开场基线；缓存若缺失，不能在半途补抓一份冒充开场。
    return await launch(ctx, thread, {
      ...(thread.engineHandle === undefined ? {} : { resume: thread.engineHandle }),
      captureBaseline: false,
    })
  } catch (error) {
    if (ctx.closed || ctx.removed.has(thread.id)) throw error
    const at = ctx.deps.now()
    const latest = entry.thread
    entry.lease.active = true
    entry.thread = {
      ...withQueue(previous, entry.queued, at),
      title: latest.title,
      draft: latest.draft,
      draftAttachments: latest.draftAttachments,
      draftRevision: latest.draftRevision,
      ...(latest.named === true ? { named: true } : {}),
      ...(latest.segments === undefined ? {} : { segments: latest.segments }),
    }
    ctx.live.set(thread.id, entry)
    emit(ctx, { type: "thread.updated", at, thread: entry.thread })
    throw error
  }
}

function installed(ctx: Ctx, threadId: ThreadId, old: Live): Live {
  const current = ctx.live.get(threadId)
  if (current === undefined || current === old) throw new Error("新引擎启动后会话没有接入")
  current.queued = [...old.queued]
  current.draining = old.draining
  carryRules(old, current)
  current.thread = {
    ...withQueue(current.thread, current.queued),
    title: old.thread.title,
    draft: old.thread.draft,
    draftAttachments: old.thread.draftAttachments,
    draftRevision: old.thread.draftRevision,
    ...(old.thread.named === true ? { named: true } : {}),
    ...(old.thread.segments === undefined ? {} : { segments: old.thread.segments }),
  }
  void current.session.setTitle?.(current.thread.title).catch(() => undefined)
  return current
}

async function finishSwitch(
  ctx: Ctx,
  old: Live,
  current: Live,
  result: { early: string | undefined; intoTurn: boolean },
): Promise<void> {
  await old.session.dispose().catch(() => undefined)
  if (!isCurrent(ctx, current)) return
  const at = ctx.deps.now()
  // 握手完成就是 idle；`intoTurn` 只表示紧接着会发一句，不代表引擎仍在启动。
  // 下一步若因附件能力等前置校验被拒，留下 starting 会让输入区永久不可用。
  if (current.thread.status === "starting") {
    current.thread = { ...current.thread, status: "idle", updatedAt: at }
  }
  emit(ctx, { type: "thread.updated", at, thread: current.thread })
  if (result.early !== undefined) rememberHandle(ctx, current.thread.id, result.early)
  if (!result.intoTurn && current.queued.length > 0) ctx.drain?.(current.thread.id)
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
 * 上一家若公开可定位的原始记录路径，omni 已存在 `Thread.segments` 里（`/timeline` 看得见），
 * 新的一家自己有文件工具，要读的时候读全量原文。
 */
export async function switchEngine(
  ctx: Ctx,
  threadId: ThreadId,
  to: string,
  intoTurn = false,
): Promise<void> {
  const entry = ctx.live.get(threadId)
  if (entry === undefined) throw new Error(`会话不存在：${threadId}`)
  if (entry.thread.engine === to) return
  if (ctx.deps.drivers[to] === undefined) throw new Error(`未注册的引擎：${to}`)
  if (entry.turn !== undefined) throw new Error("当前轮次尚未结束，不能立即切换引擎")

  const at = ctx.deps.now()
  const previous = entry.thread
  // **切回去要续上那一家自己的那条**，不是新开一条。
  //
  // 上一版把 `engineHandle` 清成 undefined（「换了引擎，上一家的句柄就没用了」），
  // 于是：codex 跑了一半，切去 Claude 看一眼，再切回来时 codex 已经不记得
  // 自己做过什么了。而每一家的句柄本来就各存各的（`segments`），
  // 切回来查一下就有。
  const back = latestSegment(previous, to)
  const thread = switched(previous, to, back, {
    at,
    status: intoTurn ? "starting" : "idle",
  })
  // 启动新引擎可能要几秒；先把“正在切”发出去，旧改动卡与旧引擎状态立即退出视线。
  entry.thread = { ...previous, status: "starting", updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  // **旧条目留作过渡壳**：新 launch 有独立 lease，握手期句柄留在自己的 early 槽里；
  // 旧条目暂时留着，
  // 第二句话才能排队，而不是撞上“会话不存在”后从输入框消失。
  entry.gate.settleAll()
  entry.lease.active = false
  const early = await replacement(ctx, entry, thread, previous)
  const current = installed(ctx, threadId, entry)
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
  // 发 live 里的能力；随后补握手期句柄，并在直接切换时继续排队消息。
  await finishSwitch(ctx, entry, current, { early, intoTurn })
}

function latestSegment(thread: Thread, engine: string): EngineSegment | undefined {
  const segments = thread.segments ?? []
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment?.engine === engine) return segment
  }
  return undefined
}

/**
 * 换过引擎之后这条会话长什么样。
 *
 * **模型和强度清掉**：它们跟着引擎走，上一家的模型 id 在新的一家那里
 * 通常根本不存在。清单同理——渲染层认「这份是谁报的」（见 store 的 `modelsOf`），
 * 新那家报上来之前，选择器上什么都不摆。
 */
function switched(
  prev: Thread,
  to: string,
  back: EngineSegment | undefined,
  transition: { at: number; status: Thread["status"] },
): Thread {
  const next: Thread = {
    ...prev,
    engine: to,
    // 临时会话在旧那家**什么都没发生过**，历史里不该留一笔——
    // 点开下拉挑了三次就记三条的话，`/timeline` 会被「我点错了」填满
    engineHistory: prev.provisional === true ? [to] : [...prev.engineHistory, to],
    ...(back === undefined ? { engineHandle: undefined } : { engineHandle: back.handle }),
    ...(back === undefined ? { engineProfile: undefined } : { engineProfile: back.profile }),
    model: undefined,
    effort: undefined,
    status: transition.status,
    updatedAt: transition.at,
  }
  delete next.nextEngine
  // 这四份都由当前引擎握手/回调重建。沿用上一家的值会在新状态到达前撒谎，
  // 更糟的是 `rememberEngineState` 会合并轴，最终把两家状态拼成一份不存在的状态。
  delete next.engineState
  delete next.goal
  delete next.trustApply
  delete next.capabilities
  return next
}
