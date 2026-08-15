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
}

/**
 * 这些事件**不属于任何一个会话**，因此不落盘。
 * `thread.removed` 尤其要在这里：写了只会把刚删掉的文件建回来。
 */
const UNOWNED: ReadonlySet<string> = new Set(["thread.removed", "engines.available"])

/** 一条事件属于哪个会话。判不出就不落盘——宁可少一条，也不要落到错的文件里。 */
export function ownerOf(ctx: Ctx, event: Event): ThreadId | undefined {
  if (UNOWNED.has(event.type)) return undefined
  switch (event.type) {
    case "thread.started":
    case "thread.updated":
      return event.thread.id
    case "turn.started":
      return event.turn.threadId
    case "turn.completed":
      return ctx.turnOwner.get(event.turnId)
    case "item.started":
    case "item.updated":
      return ctx.turnOwner.get(event.item.turnId)
    case "usage.updated":
    case "engine.status":
    case "models.updated":
      return event.threadId === "" ? undefined : event.threadId
    default:
      return undefined
  }
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
    setStatus(ctx, entry, event.status === "failed" ? "failed" : "idle")
    return
  }
}
