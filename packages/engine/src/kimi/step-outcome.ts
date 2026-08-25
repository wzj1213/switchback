import type { ToolCallItem, TurnId } from "@omni/protocol"
import { finishTool, transcriptTool } from "./tool.js"
import type { KimiTurnTracker } from "./turn.js"
import type { KimiPayload, KimiTranscriptFrame } from "./wire.js"

const TOOL_TRUNCATED = "Model hit max_tokens — tool call was truncated before it could run."
const NO_TOOL_EMITTED = "Model hit max_tokens — no tool call was emitted."
const PROVIDER_FILTERED = "Provider safety policy blocked the response."
const ARGUMENT_PREVIEW_MAX = 64 * 1024

function argumentPreview(current: string, next: string | undefined): string {
  const kept = current.slice(0, ARGUMENT_PREVIEW_MAX)
  return `${kept}${(next ?? "").slice(0, ARGUMENT_PREVIEW_MAX - kept.length)}`
}

export function kimiMaxTokensMessage(hasPartialTool: boolean): string {
  return hasPartialTool ? TOOL_TRUNCATED : NO_TOOL_EMITTED
}

export function kimiProviderFilteredMessage(rawFinishReason?: string): string {
  return `${PROVIDER_FILTERED}\nThe model output was filtered (${rawFinishReason ?? "content_filter"}).`
}

export function kimiStepInterruptionMessage(
  payload: Pick<KimiPayload, "reason" | "message">,
): string | undefined {
  const reason = payload.reason
  if (reason === "error") return undefined
  if (reason === "aborted" || reason === undefined || reason === "") {
    return payload.message === undefined || payload.message === ""
      ? "Interrupted by user"
      : payload.message
  }
  return reason === "max_steps"
    ? "reached per-turn step limit (max_steps)"
    : `step interrupted (${reason})`
}

export function isKimiTruncatedTool(
  finishReason: string | undefined,
  frame: KimiTranscriptFrame,
): boolean {
  return (
    finishReason === "max_tokens" &&
    frame.kind === "tool" &&
    frame.state === "running" &&
    frame.inputText !== undefined
  )
}

export function kimiTruncatedTranscriptTool(
  frame: Extract<KimiTranscriptFrame, { kind: "tool" }>,
  turnId: TurnId,
  at: number,
): ToolCallItem {
  const base = transcriptTool(
    {
      ...frame,
      name: frame.name || "Tool",
      input: frame.input ?? frame.inputText?.slice(0, ARGUMENT_PREVIEW_MAX),
    },
    turnId,
    at,
  )
  return finishTool(base, TOOL_TRUNCATED, true)
}

interface PartialTool {
  name: string
  inputText: string
}

/** 保留当前 step 的半截工具参数；只采用 Kimi 自报的 step 结论。 */
export class KimiStepOutcomes {
  private readonly partialTools = new Map<string, PartialTool>()
  private readonly reportedInterruptions = new Set<string>()
  private readonly reportedConclusions = new Set<string>()
  private partialTurnId: number | undefined

  constructor(private readonly tracker: KimiTurnTracker) {}

  handle(payload: KimiPayload, at: number): boolean {
    const type = payload.type
    if (type === "turn.started") {
      this.reportedInterruptions.clear()
      this.reportedConclusions.clear()
      this.reset(payload.turnId)
    } else if (type === "turn.step.started") this.reset(payload.turnId)
    if (type === "tool.call.delta") return this.delta(payload)
    if (type === "tool.call.started") this.drop(payload.toolCallId)
    if (type === "turn.step.completed") return this.completed(payload, at)
    if (type === "turn.step.interrupted") return this.interrupted(payload, at)
    if (type === "turn.ended") {
      this.reset(undefined)
      this.reportedInterruptions.clear()
      this.reportedConclusions.clear()
    }
    return false
  }

  private delta(payload: KimiPayload): true {
    if (payload.turnId !== this.partialTurnId) this.reset(payload.turnId)
    const id = payload.toolCallId
    if (id === undefined) return true
    const previous = this.partialTools.get(id)
    this.partialTools.set(id, {
      name: payload.name ?? previous?.name ?? "Tool",
      inputText: argumentPreview(previous?.inputText ?? "", payload.argumentsPart),
    })
    return true
  }

  private drop(toolCallId: string | undefined): void {
    if (toolCallId !== undefined) this.partialTools.delete(toolCallId)
  }

  private completed(payload: KimiPayload, at: number): boolean {
    const partial = payload.turnId === this.partialTurnId ? [...this.partialTools] : []
    this.reset(undefined)
    const filtered = payload.providerFinishReason === "filtered"
    if (!filtered && payload.finishReason !== "max_tokens") return false
    const key = `${String(payload.turnId)}:${String(payload.step)}`
    if (this.reportedConclusions.has(key)) return true
    this.reportedConclusions.add(key)
    if (filtered) {
      this.tracker.notice(
        {
          type: "warning",
          turnId: payload.turnId,
          message: kimiProviderFilteredMessage(payload.rawFinishReason),
        },
        at,
      )
      return true
    }
    for (const [id, tool] of partial) this.failPartial(payload.turnId, id, tool, at)
    this.tracker.notice(
      {
        type: "warning",
        turnId: payload.turnId,
        message: kimiMaxTokensMessage(partial.length > 0),
      },
      at,
    )
    return true
  }

  private interrupted(payload: KimiPayload, at: number): true {
    this.reset(undefined)
    const key = `${String(payload.turnId)}:${String(payload.step)}`
    if (this.reportedInterruptions.has(key)) return true
    this.reportedInterruptions.add(key)
    const message = kimiStepInterruptionMessage(payload)
    if (message !== undefined) {
      this.tracker.notice({ ...payload, type: "error", message, retryable: true }, at)
    }
    return true
  }

  private failPartial(turnId: number | undefined, id: string, tool: PartialTool, at: number): void {
    this.tracker.toolStarted({ turnId, toolCallId: id, name: tool.name, args: tool.inputText }, at)
    this.tracker.toolResult({ turnId, toolCallId: id, output: TOOL_TRUNCATED, isError: true }, at)
  }

  private reset(turnId: number | undefined): void {
    this.partialTools.clear()
    this.partialTurnId = turnId
  }
}
