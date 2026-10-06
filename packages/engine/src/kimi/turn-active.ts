import type { ToolCallItem, TurnId } from "@switchback/protocol"
import type { KimiOperation } from "./compaction.js"
import type { KimiTextState } from "./text-stream.js"

export interface KimiActiveTurn {
  generation: number
  startedAt: number
  turnId: TurnId
  prompt: string
  operation: KimiOperation
  promptId?: string
  activationAccepted: boolean
  native?: number
  nativePart: number
  step: number
  assistant: KimiTextState
  reasoning: KimiTextState
  /** 当前连续文本的类型。换类型或插入工具时，旧片段就地收口。 */
  openText?: KimiTextState["kind"]
  tools: Map<string, ToolCallItem>
  planStarted: boolean
  retryStarted: boolean
  compactionStarted: boolean
  noticeSeq: number
  awaitingContinuation: boolean
}
