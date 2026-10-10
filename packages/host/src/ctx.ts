import type { Event, ThreadId, Thread, ThreadStatus, TurnId, ItemId } from "@switchback/protocol"
import { handedBack, promptsOf, withQueue, type QueuedPrompt } from "./queued.js"
import type { Rule } from "@switchback/approval"
import type { EngineSession } from "@switchback/engine"
import { notePace, type PaceBook } from "@switchback/store"
import type { Gate } from "./gate.js"
import type { HostDeps } from "./deps.js"
import { clearThreadLiveState, clearTurnLiveState, rememberLiveState } from "./live-state.js"

export { liveStateOf } from "./live-state.js"

/**
 * 宿主的共享状态与**事件的唯一出口**。
 *
 * 单独一个文件是因为 `host.ts` / `session.ts` / `approval.ts` 三边都要用它，
 * 放在任何一边都会造成循环 import。
 */

export interface Live {
  thread: Thread
  session: EngineSession
  gate: Gate
  /**
   * 一次 `launch` 的身份。thread id 在接力时不变，**对象身份会变**；所有异步回调
   * 都要同时认这两样，不能只凭 thread id 把上一家迟到的结果写进新会话。
   */
  lease: { active: boolean; installing?: boolean }
  /** 当前未结束的轮次；审批卡要挂在它下面 */
  turn: TurnId | undefined
  /**
   * 这个会话当前生效的记忆规则：开会话时从磁盘读到的 project 级
   * ＋ 会话中途勾出来的 session 级。**可变**，因为用户随时会加一条。
   */
  rules: Rule[]
  /** 挂着的审批 → 它的建议规则。用户勾了记忆才用得上。 */
  suggests: Map<ItemId, Rule>
  /**
   * 「这一轮剩下的都别再问了」armed 在哪一轮上。
   *
   * **存的是轮次 id，不是布尔**——这样它的失效不需要任何人记得去清：
   * 下一轮的 id 不一样，比较自然就不成立了。布尔的话，得在
   * `turn.completed`、被打断、切引擎、会话回收四处各清一次，
   * 漏一处就是「用户以为只放行了那一轮，其实一直开着」。
   */
  passTurn?: TurnId
  /**
   * 排着队等这一轮跑完再发的话。**可变**。
   *
   * 放在宿主而不是渲染层：渲染层重载一次队列就没了，而用户打完那句话
   * 就当它已经交出去了。放在这里，重载之后队列还在（全量重建带着 thread 一起回来）。
   */
  queued: QueuedPrompt[]
  /** 队首已经进入发送流程、尚未收到 prompt RPC 确认；取回时不能再复制这一条。 */
  draining?: QueuedPrompt
  /**
   * 按停止时正在跑的那一轮。按下那一刻排着的已经清掉了（`thread.interrupt`），
   * 所以它以中断收工时，队列里还在的都是**按停止之后**才说的话——照常续发，不能陪着作废。
   */
  stopping?: TurnId
  /**
   * 引擎确实收下了的最近一轮（prompt RPC 回了包）和它开始的时刻。分段只为它记：prompt 阶段
   * 就被拒的那句引擎从没听到，不能算「这一家开过口」——否则下一句不再附交接说明（见 `segment.ts`）。
   * 记下开始时刻是因为分段的起点要写这一轮开始的那一刻，界面靠它把转录内容对到「谁跑的」。
   */
  accepted?: { turn: TurnId; at: number }
}

/**
 * 把排着的几句交回输入框（取回、开轮前就被拒）：从队列里摘掉，文字与附件放进草稿，换一个新身份。
 * 输入框认身份决定要不要并进来（见渲染层 `use-host-draft.ts`），并的时候接在已有正文后面。
 */
export function handBack(ctx: Ctx, entry: Live, taken: readonly QueuedPrompt[]): void {
  if (taken.length === 0) return
  entry.queued = entry.queued.filter((prompt) => !taken.includes(prompt))
  const at = ctx.deps.now()
  entry.thread = handedBack(entry.thread, { rest: entry.queued, taken }, ctx.deps.newId("dr"), at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** `launch` 握手前的条目；session/gate 会在驱动成功启动后补上。 */
export function preparingLive(thread: Thread, lease: Live["lease"], rules: Rule[]): Live {
  return {
    thread,
    session: undefined as unknown as EngineSession,
    gate: undefined as unknown as Gate,
    lease,
    turn: undefined,
    rules,
    suggests: new Map<ItemId, Rule>(),
    queued: promptsOf(thread),
  }
}

/** 收起来的会话该是什么状态：背后没有进程，「在跑」「等审批」都作废；「失败」是上一轮的真实结局，留着。 */
export function resting(status: Thread["status"]): Thread["status"] {
  return status === "failed" ? "failed" : "idle"
}

/** 这份 Live 仍是该 thread 此刻登记的那一代。 */
export function isCurrent(ctx: Ctx, entry: Live): boolean {
  return !ctx.closed && entry.lease.active && ctx.live.get(entry.thread.id)?.lease === entry.lease
}

/** ready 收尾共用：只让仍是当前代际、且确有待发消息的会话进入 drain。 */
export function drainQueued(ctx: Ctx, entry: Live | undefined): void {
  if (entry === undefined || !isCurrent(ctx, entry) || entry.queued.length === 0) return
  ctx.drain?.(entry.thread.id)
}

/** 启动没成功、会话尚未成立时，回收临时事件槽与已取的工作树基线。 */
export async function discardUnstarted(ctx: Ctx, threadId: ThreadId): Promise<void> {
  ctx.uncommitted.delete(threadId)
  await ctx.deps.removeWorktreeBaseline?.(threadId).catch(() => undefined)
}

/** 基线完成前后都认删除墓碑，确保引擎没有机会在已删除 thread 上启动。 */
export async function ensureLaunchable(
  ctx: Ctx,
  thread: Thread,
  captureBaseline: boolean,
): Promise<void> {
  if (ctx.closed) throw new Error("宿主已经关闭")
  if (ctx.removed.has(thread.id)) throw new Error(`会话已经删除：${thread.id}`)
  if (captureBaseline) await ctx.deps.ensureWorktreeBaseline?.(thread.id, thread.cwd)
  if (ctx.closed) throw new Error("宿主已经关闭")
  if (ctx.removed.has(thread.id)) throw new Error(`会话已经删除：${thread.id}`)
}

/** driver.start 与删除撞车时，刚起好的进程在登记前自行回收。 */
export async function attachStarted(ctx: Ctx, entry: Live, session: EngineSession): Promise<void> {
  entry.session = session
  if (!ctx.closed && !ctx.removed.has(entry.thread.id)) return
  entry.lease.active = false
  await entry.session.dispose().catch(() => undefined)
  throw new Error(ctx.closed ? "宿主已经关闭" : `会话已经删除：${entry.thread.id}`)
}

export interface Ctx {
  deps: HostDeps
  /** 退出一落定，所有在途启动与迟到回调都只能回收，不能再接入。 */
  closed: boolean
  live: Map<ThreadId, Live>
  /** 删除命令先落墓碑；任何仍在启动途中的同 id 会话都不得再接入。 */
  removed: Set<ThreadId>
  /**
   * turn id → 它属于哪个会话。
   *
   * 落盘要按会话分文件，而 `turn.completed` / `item.*` 只带 turn id。
   * `Live.turn` 会在轮次结束时被清空，所以不能靠它——必须单独记一份。
   */
  turnOwner: Map<TurnId, ThreadId>
  /**
   * 在途的「起引擎」命令，键见 `host.ts` 的 `inflightKey`。
   *
   * 放在 ctx 而不是模块级：一个进程里可能有多个 host 实例（测试就是），
   * 模块级的表会让它们互相拦。
   */
  inflight: Map<string, Promise<void>>
  /** 同一会话的模型、档位与接力按用户操作顺序执行，避免迟到结果反盖新选择。 */
  serial: Map<string, Promise<void>>
  /**
   * 不落盘、但描述现状的事件，各留最后一条（见 `LIVE_STATE`）。
   * 窗口重载时靠它补全——否则这些事实会在「没落盘」和「全量只读 journal」
   * 之间掉进缝里，永久消失。
   */
  liveState: Map<string, Event>
  /**
   * **还没发过第一句话的会话**：它的事件先攒在这里，不落盘。
   *
   * 点一下「+」就在磁盘上留一条记录是错的——那条会话什么都没发生，
   * 而它会一直躺在侧栏里，重启还在。你以为自己只是点开看看，
   * 结果攒出一串「新会话」，还得一条条删。
   *
   * 攒着而不是丢掉：**界面照常立刻拿到事件**（`deps.emit` 一直照发），
   * 只是磁盘要等第一句话。第一句话一发出去（`turn.started`），
   * 攒下的按原序一次写完，之后这条会话就走正常路径。
   *
   * 值是待写事件；键在表里就等于「这条会话还没提交」。
   */
  uncommitted: Map<ThreadId, Event[]>
  /**
   * 「这件事上一次说出去是什么样」——用来挡回声，见 `echoed`。
   *
   * 键是 `echoKey`，值是 `shapeOf`。item 键带 turn id，**只在自己的轮次结束时清**；
   * 多会话并发时一家的完成不能让另一家的重复快照重新穿透。
   */
  echo: Map<string, string>
  /**
   * 这一轮已经摆出去的那句报错。**只为挡重复**：`turn.completed` 带的原因
   * 和驱动自己发过的 error item 常常是同一句，摆两遍就是同一件事说两次。
   */
  explained: Map<TurnId, string>
  /**
   * 每一轮的出字节奏的账本（`@switchback/store` 的 `pace.ts`）。**只有这里看得见每一条会话的每一条增量**
   * ——渲染层只跟着眼前那条，而增量本身不落盘，回放时已经没东西可量。
   * 所以在这儿量，收工那一刻挂到 `turn.completed` 上，跟着它一起落盘、一起发出去。
   */
  pace: PaceBook
  /**
   * 把待发队列里的第一句发出去。**由 `host.ts` 在建 ctx 时填进来。**
   *
   * 不直接 import `session.ts` 的 `prompt`：那会绕成
   * ctx → session → ctx 的循环。这里只留一个洞，谁能干这活谁来填。
   */
  drain?: (threadId: ThreadId) => void
  /**
   * `drain` 发出去的那条命令 → 它对应的队首。开轮前用它核对这句还在发送流程里：
   * 等工作树快照的那几百毫秒里按了停止，`draining` 会被清掉，这句就不能再开轮。
   * 用命令对象本身作键，不给协议加字段——远程发来的命令不该能冒充队列里的那句。
   */
  drains: WeakMap<object, QueuedPrompt>
  /**
   * 一轮收工之后做点什么。**和 `drain` 同一个理由**留成洞：
   * 直接 import `prompt.ts` 会绕成 ctx → prompt → ctx 的循环。
   *
   * 现在只有一件事：把这一段的 `logPath` 补上——引擎要跑完一轮才把记录落盘。
   */
  afterTurn?: (threadId: ThreadId, turnId: TurnId) => void
}

/**
 * 这些事件**不属于任何一个会话**，因此不落盘。
 * `thread.removed` 尤其要在这里：写了只会把刚删掉的文件建回来。
 */
const UNOWNED: ReadonlySet<string> = new Set([
  "thread.removed",
  "engines.available",
  // 额度是**账号级**的，不属于任何会话；而且它每轮都变，落盘只会把
  // 一份过期数字塞回界面
  "limits.updated",
  // 斜杠命令**故意不落盘**：它是每次握手现问引擎的（用户装了什么技能只有引擎知道），
  // 落盘只会在重放时把一份过期的清单塞回界面
  "commands.updated",
  // 引擎自己存的会话清单、以及它登录的账号：同理，都是现问的，
  // 而且**不属于任何一个 Switchback 会话**
  "engine.history",
  "account.updated",
])

function forgetRemovedState(ctx: Ctx, event: Event): void {
  if (event.type !== "thread.removed") return
  ctx.uncommitted.delete(event.threadId)
  clearThreadLiveState(ctx, event.threadId)
  for (const [turnId, threadId] of ctx.turnOwner) {
    if (threadId !== event.threadId) continue
    clearTurnEcho(ctx, turnId)
    ctx.turnOwner.delete(turnId)
  }
  ctx.echo.delete(`thread\u0000${event.threadId}`)
}

function finishTurnState(ctx: Ctx, event: Event, owner: ThreadId | undefined): void {
  if (event.type !== "turn.completed" || owner === undefined) return
  clearTurnLiveState(ctx, owner)
  // 同一个 stdout chunk 里仍可能跟着终态快照；让它们先借这份归属落盘，再在微任务尾回收。
  queueMicrotask(() => {
    clearTurnEcho(ctx, event.turnId)
    if (ctx.turnOwner.get(event.turnId) === owner) ctx.turnOwner.delete(event.turnId)
  })
}

const nonemptyThreadId = (threadId: ThreadId | undefined): ThreadId | undefined =>
  threadId === "" ? undefined : threadId

/** 一条事件属于哪个会话。判不出就不落盘——宁可少一条，也不要落到错的文件里。 */
export function ownerOf(ctx: Ctx, event: Event): ThreadId | undefined {
  if (UNOWNED.has(event.type)) return undefined
  switch (event.type) {
    case "thread.started":
    case "thread.updated":
      return event.thread.id
    // 改名必须落盘。漏了这条的后果是**改完重启就还原**，而且一声不响——
    // 事件发出去了、界面也变了，只是没人把它写进那个会话的 jsonl
    case "thread.renamed":
      return event.threadId
    case "turn.started":
      return event.turn.threadId
    case "turn.completed":
      return ctx.turnOwner.get(event.turnId)
    case "item.started":
    case "item.updated":
      return ctx.turnOwner.get(event.item.turnId)
    case "item.delta":
      return nonemptyThreadId(event.threadId)
    case "item.removed":
      return ctx.turnOwner.get(event.turnId)
    // lane 自己带 threadId：它不属于任何一轮（一个 workflow 会跨好几轮）
    case "lane.updated":
      return event.threadId
    default:
      return directOwner(event)
  }
}

/**
 * 事件自己带 `threadId` 的那一批。
 *
 * 从 `ownerOf` 里分出来纯粹是复杂度闸门逼的——但分完也讲得通：
 * 上面那些要**查表或拆结构**才知道属于谁（turnOwner、event.thread.id），
 * 这些是直接写在事件上的。
 *
 * 空串当作「不属于任何会话」：引擎级的状态（比如探测结果）会这么报。
 */
function directOwner(event: Event): ThreadId | undefined {
  if (event.type !== "usage.updated" && event.type !== "usage.cleared" &&
    event.type !== "engine.status" && event.type !== "models.updated" &&
    event.type !== "thinking.updated") {
    return undefined
  }
  return nonemptyThreadId(event.threadId)
}

/**
 * 「说的是同一件事」的键。**只认 item 的三种快照变化和 thread.updated**。
 *
 * 判据是「同一个身份 ＋ 同样的内容 = 没有新信息」。剩下的事件都不满足：
 * `item.delta` 是**追加**（两条一样的增量是两次真的追加，不是回声，丢了正文就少一截）；
 * `turn.*` / `thread.started` 描述的是一次发生，不是一份现状；
 * `usage.updated` / `models.updated` 这些进 `LIVE_STATE`，那条路自己就按键留最后一条。
 * 实测九种落盘事件里，回声全部集中在这三种上（`item.*` 16.3 MB、`thread.updated` 0.73 MB，
 * 其余合计不到 0.03 MB）。
 */
function echoKey(event: Event): string | undefined {
  if (event.type === "item.started" || event.type === "item.updated") {
    return `item\u0000${event.item.turnId}\u0000${event.item.id}`
  }
  if (event.type === "item.removed") return `item\u0000${event.turnId}\u0000${event.itemId}`
  if (event.type === "thread.updated") return `thread\u0000${event.thread.id}`
  return undefined
}

function clearTurnEcho(ctx: Ctx, turnId: TurnId): void {
  const prefix = `item\u0000${turnId}\u0000`
  for (const key of ctx.echo.keys()) if (key.startsWith(prefix)) ctx.echo.delete(key)
}

/**
 * 一条事件除掉时间戳之后的样子。
 *
 * 两处 `at` 都抹掉：事件自己的 `at` 和 item 的 `at` 都是发出那一刻的 `now()`，
 * 每次都不同，而它们变了不代表内容变了。**`Thread.updatedAt` 不抹**——
 * 那是内容的一部分（真改了才会动），抹掉会把两次真实改动看成同一条。
 */
function shapeOf(event: Event): string {
  const at = { at: 0 }
  if (event.type === "item.started" || event.type === "item.updated") {
    return JSON.stringify({ ...event, ...at, item: { ...event.item, ...at } })
  }
  return JSON.stringify({ ...event, ...at })
}

/**
 * 这条事件和上一条**逐字节相同**吗——是的话整条丢掉。
 *
 * ## 为什么这道闸门在宿主，不在某一家驱动里
 *
 * 撞上它的是 ACP 那条线：`tool_call_update` 逐块推，而 Switchback 的投影常常吃不下
 * 那些块，于是同一份 `{kind:"file_edit",path:"",files:[],added:0,removed:0}`
 * 被翻译出来 9793 遍，一条工具调用写掉 2.7 MB。但**这不是 ACP 独有的形状**：
 * `thread.updated` 从宿主自己十几处发出去，其中 837 条（0.73 MB）是原样重发——
 * 每处各加一次「变了吗」的判断，就是十几个各自会忘的地方。
 *
 * 所以挡在这个唯一出口上：一次覆盖四家驱动、宿主自己，以及以后接的每一家。
 * 这不是节流（那要判断「哪些信息可以丢」，只有驱动知道，见
 * `docs/侧栏与引擎状态方案.md` 那条 `LaneProgress`），**这里丢掉的字节数是零**——
 * 除时间戳外逐字节相同的一条，对归约器、渲染层、journal 三边都是空操作。
 *
 * 落盘之外还省掉同样数量的渲染帧：那 9793 条每一条都会让工具行重画一次。
 */
function echoed(ctx: Ctx, event: Event): boolean {
  const key = echoKey(event)
  if (key === undefined) return false
  const shape = shapeOf(event)
  if (ctx.echo.get(key) === shape) return true
  ctx.echo.set(key, shape)
  return false
}

/**
 * 一轮失败了，**把原因摆进转录区**。
 *
 * 改这条之前，`turn.completed` 的 `status` 和 `error` **全代码库没有第二个读者**：
 * 归约器的 `onTurnCompleted` 只清 `turns` / `tasks`，两个字段一起丢；渲染层没有
 * 任何地方读它；`thread.status === "failed"` 也没有任何一处显示。于是引擎明说了
 * 为什么，用户看到的是**自己发出去的消息后面一片空白**。
 *
 * mac2 实拍（2026-08-24）：Kimi 连着五轮回 `401 k3-256k supports only 256K context.`
 * ——上下文超了它的窗口，每轮三秒就失败。界面上零提示，人只能以为「这个会话坏了」，
 * 而真相是「换个模型或者压一下上下文就能继续」。**能不能修，取决于看不看得见。**
 *
 * 放在宿主而不是各家驱动：codex 的 `onError` 只覆盖 `error` 通知那条路，
 * `turn/completed` 上带的 `turn.error.message` 同样没人读；kimi 与 ACP 连那条路都没有。
 * 四家各补一次就是四个各自会忘的地方——和 `echoed` 同一个理由，而这里是唯一出口，
 * `turn.completed` 必然经过。
 *
 * 三条边界：**中断不算失败**（用户自己按的停止，不需要一条报错）；
 * **驱动已经说过的同一句不重复摆**；**报错排在 `turn.completed` 之前**发出去，
 * 这样它落在那一轮里面，而不是掉到下一轮的开头。
 */
function explainFailure(ctx: Ctx, event: Event): void {
  if (event.type === "item.started" || event.type === "item.updated") {
    // 只认**致命**的那句。重试提示（`fatal: false`）常和最终失败是同一句话——
    // Kimi 重试用尽时就是这样——把它当成「已经说过」，失败卡和「再试一次」就都没了
    if (event.item.kind === "error" && event.item.fatal) ctx.explained.set(event.item.turnId, event.item.message)
    return
  }
  if (event.type !== "turn.completed") return
  const said = ctx.explained.get(event.turnId)
  ctx.explained.delete(event.turnId)
  const message = event.error
  if (event.status !== "failed" || message === undefined || message === "" || message === said) return
  // 认不出属于哪条会话就不摆：那条报错落不了盘，只会在界面上飘一条无主的红字
  if (ctx.turnOwner.get(event.turnId) === undefined) return
  const at = ctx.deps.now()
  emit(ctx, {
    type: "item.started",
    at,
    item: { id: ctx.deps.newId("it"), turnId: event.turnId, at, kind: "error", message, fatal: true },
  })
}

/**
 * **事件的唯一出口。** 所有 `emit` 都必须走这里，落盘才不会漏。
 *
 * 顺序有讲究：先发给渲染层，再落盘，最后才做旁路观察。
 * 界面响应不该等磁盘；而 `observe` 会改会话状态并再发事件，放最后免得穿插。
 */
export function emit(ctx: Ctx, raw: Event): void {
  if (ctx.closed || echoed(ctx, raw)) return
  explainFailure(ctx, raw)
  const event = paced(ctx, raw)
  if (event.type === "turn.started") ctx.turnOwner.set(event.turn.id, event.turn.threadId)
  rememberLiveState(ctx, event)
  ctx.deps.emit(event)
  // 删掉的会话如果还没提交过，攒下的那些一起扔掉——它从来没上过磁盘
  forgetRemovedState(ctx, event)
  const owner = ownerOf(ctx, event)
  if (owner !== undefined) persist(ctx, owner, event)
  observe(ctx, event)
  finishTurnState(ctx, event, owner)
}

/**
 * 量这一轮的出字节奏；收工那一条带上结果。驱动自己带了的（抄历史时照搬原来那份）不覆盖。
 */
function paced(ctx: Ctx, event: Event): Event {
  const pace = notePace(ctx.pace, event)
  if (pace === undefined || event.type !== "turn.completed" || event.pace !== undefined) return event
  return { ...event, pace }
}

/**
 * 落盘。**没发过第一句话的会话先攒着**（见 `Ctx.uncommitted`）。
 *
 * 提交的判据是 `commits()`：那条会话**不再是临时的**。
 * 攒下的连同这一条按原序写完，键从表里摘掉，之后走正常路径。
 *
 * 顺序必须原样：`thread.started` 得排在它自己的 `thread.updated` 前面，
 * 否则重放出来的是一条「先被改过、后才出生」的会话。
 */
function persist(ctx: Ctx, owner: ThreadId, event: Event): void {
  const buffered = ctx.uncommitted.get(owner)
  if (buffered === undefined) {
    void ctx.deps.journal?.append(owner, event)
    return
  }
  if (!commits(event)) {
    buffered.push(event)
    return
  }
  ctx.uncommitted.delete(owner)
  for (const pending of [...buffered, event]) void ctx.deps.journal?.append(owner, pending)
}

/**
 * 「这条会话算数了」的信号：**它不再是临时的**（`commit()` 摘掉 `provisional`
 * 时发的那条 `thread.updated`）。
 *
 * ## 为什么不能拿 `turn.started` 当信号
 *
 * 上一版就是那么写的，而 `copyTranscript` 会为抄过来的每一轮补发一条
 * `turn.started`——于是**分叉一下就把整条会话落了盘**：临时会话的全部意义
 * （没用过就不留痕）当场作废，而且是静默的。分叉出来的那条是这个问题的
 * 唯一受害者，因为只有它既在待提交表里、又会被抄进一段历史。
 *
 * 换成这个判据之后，「算不算数」在整个系统里只有一个来源：
 * 侧栏看它、磁盘也看它，两边不可能再说不同的话。
 */
function commits(event: Event): boolean {
  return event.type === "thread.updated" && event.thread.provisional !== true
}

/**
 * 会话状态的唯一改写口。
 *
 * 状态一直挂在 `Thread` 上却从来没人改过，于是侧栏那个状态点永远是灰的、
 * 界面上也无从判断「它到底在不在跑」。**状态归宿主**——只有宿主同时看得见
 * 提示词发出、审批挂起、轮次收工这三件事。
 */
export function setStatus(ctx: Ctx, entry: Live, status: ThreadStatus): void {
  if (entry.thread.status === status) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, status, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 引擎事件的旁路观察。轮次收工只有引擎知道，事件是直接发给渲染层的，
 * 宿主看不见——所以在这里截一道，把会话状态收回 idle。
 */
export function observe(ctx: Ctx, event: Event): void {
  if (event.type !== "turn.completed") return
  for (const entry of ctx.live.values()) {
    if (entry.turn !== event.turnId) continue
    entry.turn = undefined
    // **轮次一结束，就把还挂着的审批卡一并落定。**
    //
    // 中断之后轮次回到 idle，而审批卡会停在「待确认」且三个按钮都还能点。
    // 过一会儿用户点「允许」+「本项目始终允许」，卡片翻成「已允许」——
    // journal 里永久落盘 `status=allowed`，**重启回放之后这次中断读起来
    // 像是「用户批准并执行了」**，而那次调用早随中断作废了。
    // 顺带还能在一个已经死掉的上下文里被诱导授出一条永久规则。
    //
    // 工具行那边早有 `sweepInflight` 扫尾，审批卡漏扫了。
    // 正常情况下 completed 时不会再有审批；但原生事件可能乱序或提前收工。
    // 留着一张已经没有调用方等待的卡，只会让用户事后给失效请求授予规则。
    entry.gate.settleAll()
    setStatus(ctx, entry, event.status === "failed" ? "failed" : "idle")
    // **只有正常跑完才接上队列。** 中断/失败之后接着发排队的话是错的：
    // 人按停止就是要它停下，而不是"停完这句再跑下一句"
    // **不管跑成没跑成都补一次**：失败的那一轮照样在引擎那边留了记录，
    // 而「上一段跑砸了、记录在哪」恰恰是你最想去读的
    ctx.afterTurn?.(entry.thread.id, event.turnId)
    queueAfter(ctx, entry, event)
    return
  }
}

/** 一轮收工之后排着的话怎么办。 */
function queueAfter(ctx: Ctx, entry: Live, event: Extract<Event, { type: "turn.completed" }>): void {
  const stopped = entry.stopping === event.turnId
  entry.stopping = undefined
  if (event.status === "completed") ctx.drain?.(entry.thread.id)
  // 用户按的停止：按下那一刻排着的已经清过，还在的是之后才说的话，接着发
  else if (event.status === "interrupted" && stopped) {
    if (entry.queued.length > 0) ctx.drain?.(entry.thread.id)
  }
  // 失败不是用户取消：后面排好的文字与附件保留成“待发送”，让用户取回确认。
  // 引擎那边自己中断的（别的客户端按了停止）照旧清掉，避免停止之后又自动继续。
  else if (event.status !== "failed" && entry.queued.length > 0) clearQueue(ctx, entry)
}

/** 清掉待发队列并把变化发出去。中断之后用。 */
export function clearQueue(ctx: Ctx, entry: Live): void {
  entry.queued = []
  entry.draining = undefined
  const at = ctx.deps.now()
  entry.thread = withQueue(entry.thread, [], at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}
