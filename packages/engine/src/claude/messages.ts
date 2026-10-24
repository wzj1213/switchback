import type { ItemId, NoticeItem, ToolCallItem, TurnId } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { isFailedCompactionEcho } from "./compaction.js"
import { emitPlan, feedPlan, isPlanTool, type PlanState } from "./plan.js"
import { rememberMessage, retractMessages, type RetractionState } from "./retraction.js"
import { clearThinking, type ThinkingState } from "./thinking.js"
import { assistantItems, toolResults } from "./translate.js"
import { applyToolResult, type DenialState } from "./denials.js"
import { resetStream, type StreamState } from "./stream.js"
import { localeOf } from "../locale.js"

interface RawMessage {
  message?: { content?: unknown; model?: unknown }
  uuid?: unknown
  supersedes?: unknown
}

export interface MessageRef {
  current: TurnId | undefined
  seq: number
  /** 子 agent 各有一台铸币机；主线缺席时保持既有 `turn:iN` 形状。 */
  namespace?: string
  tools: Map<ItemId, ToolCallItem>
  notices: Map<string, NoticeItem>
  plan: PlanState
  thinking: ThinkingState
  retractions: RetractionState
  denials: DenialState
  stream: StreamState
}

export function makeIdMinter(ref: MessageRef, turnId: TurnId): () => ItemId {
  return () => {
    ref.seq += 1
    const namespace = ref.namespace === undefined ? "" : `:${ref.namespace}`
    return `${turnId}${namespace}:i${String(ref.seq)}`
  }
}

function updatePlan(content: readonly unknown[], ref: MessageRef, req: StartRequest, at: number): ItemId | undefined {
  const turnId = ref.current
  if (turnId === undefined) return undefined
  let changed = false
  for (const block of content) if (isPlanTool(block)) changed = feedPlan(ref.plan, block) || changed
  if (!changed) return undefined
  emitPlan(ref.plan, turnId, at, {
    threadId: req.threadId, emit: req.emit, nextId: makeIdMinter(ref, turnId),
  })
  return ref.plan.itemId
}

export function onAssistant(msg: RawMessage, ref: MessageRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  if (turnId === undefined) return
  const retract = {
    at, emit: req.emit, tools: ref.tools, plan: ref.plan,
    settledTools: ref.denials.settled, denialMessages: ref.denials.messages,
  }
  clearThinking(ref.thinking, { at, threadId: req.threadId, turnId, emit: req.emit })
  retractMessages(ref.retractions, msg.supersedes, retract)
  try {
    if (isFailedCompactionEcho(msg, ref.notices)) return
    const content = msg.message?.content
    if (!Array.isArray(content)) return
    const nextId = makeIdMinter(ref, turnId)
    const planId = updatePlan(content, ref, req, at)
    const items = assistantItems(content.filter((block) => !isPlanTool(block)), {
      turnId, at, nextId, reuse: (order) => ref.stream.byOrder.get(order), locale: localeOf(req),
    })
    for (const item of items) {
      if (item.kind === "tool_call") ref.tools.set(item.id, item)
      req.emit({ type: "item.started", at, item })
    }
    const planIds = planId === undefined ? [] : [planId]
    rememberMessage(ref.retractions, msg.uuid, turnId, [...planIds, ...items.map((item) => item.id)])
  } finally {
    // 一轮里可能有多条 assistant 消息；每条完整收尾后都清自己的增量身份。
    resetStream(ref.stream)
  }
}

/** Claude 把工具结果作为 user 角色消息发回；结果帧同样可能被拒答回退撤销。 */
export function onToolResults(msg: RawMessage, ref: MessageRef, req: StartRequest, at: number): void {
  const content = msg.message?.content
  const turnId = ref.current
  if (!Array.isArray(content) || turnId === undefined) return
  const itemIds: ItemId[] = []
  for (const result of toolResults(content)) {
    const item = applyToolResult(result, ref.denials, ref.tools, localeOf(req))
    if (item === undefined) continue
    itemIds.push(item.id)
    req.emit({ type: "item.updated", at, item })
  }
  rememberMessage(ref.retractions, msg.uuid, turnId, itemIds)
}
