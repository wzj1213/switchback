import type { ErrorItem, Event, ItemId, NoticeItem, ToolCallItem, TurnId } from "@omni/protocol"
import type { PlanState } from "./plan.js"
import { resetPlan } from "./plan.js"

interface TrackedMessage {
  turnId: TurnId
  itemIds: readonly ItemId[]
}

export interface RetractionState {
  messages: Map<string, TrackedMessage>
  removed: Set<ItemId>
}

export function createRetractionState(): RetractionState {
  return { messages: new Map(), removed: new Set() }
}

function wireId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** SDK wire uuid → 这一帧在 omni 里投影出的 item。 */
export function rememberMessage(
  state: RetractionState,
  uuid: unknown,
  turnId: TurnId,
  itemIds: readonly ItemId[],
): void {
  const id = wireId(uuid)
  const unique = [...new Set(itemIds)]
  if (id === undefined || unique.length === 0) return
  for (const itemId of unique) state.removed.delete(itemId)
  state.messages.set(id, { turnId, itemIds: unique })
}

interface RetractContext {
  at: number
  emit: (event: Event) => void
  tools: Map<ItemId, ToolCallItem>
  plan: PlanState
  settledTools?: Map<ItemId, ToolCallItem>
  denialMessages?: Map<ItemId, string>
}

function wireIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const id = wireId(raw)
    return id === undefined ? [] : [id]
  })
}

function forgetRemoved(removed: ReadonlySet<ItemId>, ctx: RetractContext): void {
  for (const [nativeId, item] of ctx.tools) if (removed.has(item.id)) ctx.tools.delete(nativeId)
  for (const itemId of removed) {
    ctx.settledTools?.delete(itemId)
    ctx.denialMessages?.delete(itemId)
  }
  if (ctx.plan.itemId !== undefined && removed.has(ctx.plan.itemId)) resetPlan(ctx.plan)
}

/** 撤回是幂等的；同一 item 同时被 assistant 与 tool_result 引用也只发一次。 */
export function retractMessages(state: RetractionState, uuids: unknown, ctx: RetractContext): void {
  const removed = new Set<ItemId>()
  const turns = new Map<ItemId, TurnId>()
  for (const uuid of wireIds(uuids)) {
    const tracked = state.messages.get(uuid)
    state.messages.delete(uuid)
    if (tracked === undefined) continue
    for (const itemId of tracked.itemIds) {
      if (state.removed.has(itemId)) continue
      removed.add(itemId)
      turns.set(itemId, tracked.turnId)
    }
  }
  for (const itemId of removed) {
    const turnId = turns.get(itemId)
    if (turnId === undefined) continue
    state.removed.add(itemId)
    ctx.emit({ type: "item.removed", at: ctx.at, turnId, itemId })
  }
  forgetRemoved(removed, ctx)
}

interface RawRefusal {
  subtype?: unknown
  direction?: unknown
  scope?: unknown
  original_model?: unknown
  fallback_model?: unknown
  retracted_message_uuids?: unknown
  content?: unknown
}

interface RefusalContext extends RetractContext {
  turnId: TurnId | undefined
  nextId?: () => ItemId
  onModel?: (model: string | undefined, effort: string | undefined) => void
}

function reportedModel(raw: RawRefusal): string | undefined {
  if (raw.scope === "local") return undefined
  if (raw.direction === "revert") return wireId(raw.original_model)
  if (raw.direction === "retry" || raw.direction === "sticky") return wireId(raw.fallback_model)
  return undefined
}

function emitRefusalText(raw: RawRefusal, ctx: RefusalContext): void {
  if (ctx.turnId === undefined || ctx.nextId === undefined || typeof raw.content !== "string" || raw.content === "") return
  const base = { id: ctx.nextId(), turnId: ctx.turnId, at: ctx.at }
  const item: NoticeItem | ErrorItem = raw.subtype === "model_refusal_fallback"
    ? { ...base, kind: "notice", message: raw.content, level: "warning" }
    : { ...base, kind: "error", message: raw.content, fatal: false }
  ctx.emit({ type: "item.started", at: ctx.at, item })
}

/** 处理拒答后的权威撤回、会话模型漂移与原生说明；不从分类字段拼文案。 */
export function onModelRefusal(raw: unknown, state: RetractionState, ctx: RefusalContext): void {
  if (typeof raw !== "object" || raw === null) return
  const message = raw as RawRefusal
  if (message.subtype !== "model_refusal_fallback" && message.subtype !== "model_refusal_no_fallback") return
  if (message.subtype === "model_refusal_fallback") {
    retractMessages(state, message.retracted_message_uuids, ctx)
    const model = reportedModel(message)
    if (model !== undefined) ctx.onModel?.(model, undefined)
  }
  emitRefusalText(message, ctx)
}

export function clearRetractions(state: RetractionState): void {
  state.messages.clear()
  state.removed.clear()
}
