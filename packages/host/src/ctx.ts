import type { Event, ThreadId, Thread, ThreadStatus, TurnId, ItemId } from "@omni/protocol"
import type { Rule } from "@omni/approval"
import type { EngineSession } from "@omni/engine"
import type { Gate } from "./gate.js"
import type { HostDeps } from "./deps.js"

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
  lease: { active: boolean }
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
}

export interface QueuedPrompt {
  text: string
  attachments?: readonly string[]
}

export function queuedTexts(queued: readonly QueuedPrompt[]): string[] {
  return queued.map((prompt) => prompt.text)
}

/** 把宿主的完整队列投影到协议 Thread；附件与文字始终按下标对齐。 */
export function withQueue(thread: Thread, queued: readonly QueuedPrompt[], updatedAt = thread.updatedAt): Thread {
  const next = { ...thread }
  delete next.queuedAttachments
  const attachments = queued.map((prompt) => [...(prompt.attachments ?? [])])
  return {
    ...next,
    queued: queuedTexts(queued),
    ...(attachments.some((paths) => paths.length > 0) ? { queuedAttachments: attachments } : {}),
    updatedAt,
  }
}

function promptsOf(thread: Thread): QueuedPrompt[] {
  return (thread.queued ?? []).map((text, index) => {
    const attachments = thread.queuedAttachments?.[index]
    return {
      text,
      ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
    }
  })
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
   * 把待发队列里的第一句发出去。**由 `host.ts` 在建 ctx 时填进来。**
   *
   * 不直接 import `session.ts` 的 `prompt`：那会绕成
   * ctx → session → ctx 的循环。这里只留一个洞，谁能干这活谁来填。
   */
  drain?: (threadId: ThreadId) => void
  /**
   * 一轮收工之后做点什么。**和 `drain` 同一个理由**留成洞：
   * 直接 import `prompt.ts` 会绕成 ctx → prompt → ctx 的循环。
   *
   * 现在只有一件事：把这一段的 `logPath` 补上——引擎要跑完一轮才把记录落盘。
   */
  afterTurn?: (threadId: ThreadId) => void
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
  // 而且**不属于任何一个 omni 会话**
  "engine.history",
  "account.updated",
])

/**
 * 不落盘、但**描述现状**的事件。重建全量时必须把最后一条补发出去。
 *
 * ## 这条规则是拿一个真 bug 换来的
 *
 * 「不落盘」和「重建只读 journal」两条规则各自都对，合在一起就有个缝：
 * 这类事件既不在全量里，又会因为 `seq <= resumeAt` 被渲染层当旧消息丢掉，
 * **于是永久消失**。实测表现是 `/` 面板里一条技能都没有——codex 明明报了 22 条，
 * `skills/list` 也是通的，事件也确实发出去过，就是没活到界面上。
 *
 * 同病的还有 `limits.updated`（额度条重载后一直空着）。
 *
 * 区别于 `thread.removed`：那是一次**变化**，补发只会把删掉的东西变回来。
 * 收进这里的标准是「它描述的是现在是什么样，重放一遍不会有副作用」。
 */
const LIVE_STATE: ReadonlySet<string> = new Set([
  "limits.updated",
  "commands.updated",
  "engine.history",
  "account.updated",
])

/**
 * 这类事件按「说的是哪一份」留最后一条：额度按引擎、命令按会话。
 * 键错了的后果是互相覆盖——两家引擎的额度只剩一份。
 */
function liveKey(event: Event): string | undefined {
  if (event.type === "limits.updated") return `limits:${event.engine}`
  if (event.type === "commands.updated") return `commands:${event.threadId}\u0000${event.engine}`
  if (event.type === "engine.history") return `history:${event.engine}`
  if (event.type === "account.updated") return `account:${event.engine}`
  return undefined
}

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
    event.type !== "engine.status" && event.type !== "models.updated") {
    return undefined
  }
  return event.threadId === "" ? undefined : event.threadId
}

/**
 * **事件的唯一出口。** 所有 `emit` 都必须走这里，落盘才不会漏。
 *
 * 顺序有讲究：先发给渲染层，再落盘，最后才做旁路观察。
 * 界面响应不该等磁盘；而 `observe` 会改会话状态并再发事件，放最后免得穿插。
 */
export function emit(ctx: Ctx, event: Event): void {
  if (ctx.closed) return
  if (event.type === "turn.started") ctx.turnOwner.set(event.turn.id, event.turn.threadId)
  const key = LIVE_STATE.has(event.type) ? liveKey(event) : undefined
  if (key !== undefined) ctx.liveState.set(key, event)
  ctx.deps.emit(event)
  // 删掉的会话如果还没提交过，攒下的那些一起扔掉——它从来没上过磁盘
  if (event.type === "thread.removed") {
    ctx.uncommitted.delete(event.threadId)
    const prefix = `commands:${event.threadId}\u0000`
    for (const key of ctx.liveState.keys()) if (key.startsWith(prefix)) ctx.liveState.delete(key)
  }
  const owner = ownerOf(ctx, event)
  if (owner !== undefined) persist(ctx, owner, event)
  observe(ctx, event)
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
 * 重建全量时要补发的那些事件（见 `LIVE_STATE`）。
 *
 * 会话已经不在了的就别补了——它对应的那一行界面上都没有，
 * 补一份技能清单过去只会在 store 里留一条永远不会被读到的记录。
 */
export function liveStateOf(ctx: Ctx): readonly Event[] {
  return [...ctx.liveState.entries()]
    .filter(([key]) => {
      if (!key.startsWith("commands:")) return true
      const rest = key.slice("commands:".length)
      const end = rest.indexOf("\u0000")
      const threadId = (end === -1 ? rest : rest.slice(0, end)) as ThreadId
      return ctx.live.has(threadId)
    })
    .map(([, event]) => event)
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
    ctx.afterTurn?.(entry.thread.id)
    if (event.status === "completed") ctx.drain?.(entry.thread.id)
    // 失败不是用户取消：后面排好的文字与附件保留成“待发送”，让用户取回确认。
    // 只有明确中断才清掉，避免停止之后又自动继续。
    else if (event.status !== "failed" && entry.queued.length > 0) clearQueue(ctx, entry)
    return
  }
}

/** 清掉待发队列并把变化发出去。中断之后用。 */
export function clearQueue(ctx: Ctx, entry: Live): void {
  entry.queued = []
  entry.draining = undefined
  const at = ctx.deps.now()
  entry.thread = withQueue(entry.thread, [], at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}
