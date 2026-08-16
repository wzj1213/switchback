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
   * 排着队等这一轮跑完再发的话。**可变**。
   *
   * 放在宿主而不是渲染层：渲染层重载一次队列就没了，而用户打完那句话
   * 就当它已经交出去了。放在这里，重载之后队列还在（全量重建带着 thread 一起回来）。
   */
  queued: string[]
}

export interface Ctx {
  deps: HostDeps
  live: Map<ThreadId, Live>
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
  /**
   * 把待发队列里的第一句发出去。**由 `host.ts` 在建 ctx 时填进来。**
   *
   * 不直接 import `session.ts` 的 `prompt`：那会绕成
   * ctx → session → ctx 的循环。这里只留一个洞，谁能干这活谁来填。
   */
  drain?: (threadId: ThreadId) => void
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
])

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
  if (event.type !== "usage.updated" && event.type !== "engine.status" && event.type !== "models.updated") {
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
  if (event.type === "turn.started") ctx.turnOwner.set(event.turn.id, event.turn.threadId)
  ctx.deps.emit(event)
  const owner = ownerOf(ctx, event)
  if (owner !== undefined) void ctx.deps.journal?.append(owner, event)
  observe(ctx, event)
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
    // **这一轮没跑完就结束的，把还挂着的审批卡一并落定。**
    //
    // 中断之后轮次回到 idle，而审批卡会停在「待确认」且三个按钮都还能点。
    // 过一会儿用户点「允许」+「本项目始终允许」，卡片翻成「已允许」——
    // journal 里永久落盘 `status=allowed`，**重启回放之后这次中断读起来
    // 像是「用户批准并执行了」**，而那次调用早随中断作废了。
    // 顺带还能在一个已经死掉的上下文里被诱导授出一条永久规则。
    //
    // 工具行那边早有 `sweepInflight` 扫尾，审批卡漏扫了。
    if (event.status !== "completed") entry.gate.settleAll()
    setStatus(ctx, entry, event.status === "failed" ? "failed" : "idle")
    // **只有正常跑完才接上队列。** 中断/失败之后接着发排队的话是错的：
    // 人按停止就是要它停下，而不是"停完这句再跑下一句"
    if (event.status === "completed") ctx.drain?.(entry.thread.id)
    else if (entry.queued.length > 0) clearQueue(ctx, entry)
    return
  }
}

/** 清掉待发队列并把变化发出去。中断之后用。 */
export function clearQueue(ctx: Ctx, entry: Live): void {
  entry.queued = []
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, queued: [], updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}
