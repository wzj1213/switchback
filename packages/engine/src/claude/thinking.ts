import type { Event, ThreadId, TurnId } from "@omni/protocol"

interface ThinkingMessage {
  subtype?: string
  estimated_tokens?: unknown
}

interface ThinkingFrame {
  at: number
  threadId: ThreadId
  turnId: TurnId
  emit: (event: Event) => void
}

/** SDK 的 running total 只属于当前 thinking block，不是最终计费值。 */
export interface ThinkingState {
  estimatedTokens: number | undefined
}

export function createThinkingState(): ThinkingState {
  return { estimatedTokens: undefined }
}

function estimateOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined
  return value
}

/** 同一总数不重复推；畸形帧不拿 delta 猜 running total。 */
export function emitThinking(
  state: ThinkingState,
  message: ThinkingMessage,
  frame: ThinkingFrame,
): void {
  if (message.subtype !== "thinking_tokens") return
  const estimatedTokens = estimateOf(message.estimated_tokens)
  if (estimatedTokens === undefined || estimatedTokens === state.estimatedTokens) return
  state.estimatedTokens = estimatedTokens
  frame.emit({
    type: "thinking.updated",
    at: frame.at,
    threadId: frame.threadId,
    turnId: frame.turnId,
    estimatedTokens,
  })
}

/** 输出、工具调用与收工都会结束当前思考块；清空事件同样不落盘。 */
export function clearThinking(state: ThinkingState, frame: ThinkingFrame): void {
  if (state.estimatedTokens === undefined) return
  state.estimatedTokens = undefined
  frame.emit({
    type: "thinking.updated",
    at: frame.at,
    threadId: frame.threadId,
    turnId: frame.turnId,
  })
}
