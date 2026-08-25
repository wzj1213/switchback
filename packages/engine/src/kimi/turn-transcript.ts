import { isKimiTruncatedTool } from "./step-outcome.js"
import type { KimiTurnEvents } from "./turn-events.js"
import type { KimiTurnTracker } from "./turn.js"
import type { KimiTranscriptFrame, KimiTranscriptTurn } from "./wire.js"

interface RecoveryContext {
  events: KimiTurnEvents
  native: number
  at: number
}

interface FrameContext extends RecoveryContext {
  finishReason?: string
  assistantOffset: number
  thinkingOffset: number
}

function nativeId(turnId: string): number | undefined {
  const match = /^t(\d+)$/.exec(turnId)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : undefined
}

function matchingNative(tracker: KimiTurnTracker, turn: KimiTranscriptTurn): number | undefined {
  const native = nativeId(turn.turnId)
  if (native === undefined) return undefined
  const current = tracker.currentNative()
  if (current !== undefined) return current === native ? native : undefined
  const prompt = tracker.currentPrompt()
  const startedAt = turn.startedAt === undefined ? Number.NaN : new Date(turn.startedAt).getTime()
  const afterBegin =
    !Number.isNaN(startedAt) &&
    startedAt >= (tracker.currentStartedAt() ?? Number.POSITIVE_INFINITY)
  return prompt !== undefined && prompt !== "" && turn.prompt === prompt && afterBegin
    ? native
    : undefined
}

function recoverTool(
  context: FrameContext,
  frame: Extract<KimiTranscriptFrame, { kind: "tool" }>,
): void {
  if (isKimiTruncatedTool(context.finishReason, frame)) {
    context.events.handle(
      {
        type: "tool.call.delta",
        turnId: context.native,
        toolCallId: frame.toolCallId,
        name: frame.name || "Tool",
        argumentsPart: frame.inputText,
      },
      context.at,
    )
    return
  }
  context.events.handle(
    {
      type: "tool.call.started",
      turnId: context.native,
      toolCallId: frame.toolCallId,
      name: frame.name || "Tool",
      args: frame.input ?? frame.inputText,
      display: frame.display,
    },
    context.at,
  )
  if (frame.state === "running") return
  context.events.handle(
    {
      type: "tool.result",
      turnId: context.native,
      toolCallId: frame.toolCallId,
      output: frame.output ?? frame.error,
      isError: frame.state === "error",
    },
    context.at,
  )
}

function recoverFrame(context: FrameContext, frame: KimiTranscriptFrame): void {
  if (frame.kind === "text" && frame.role === "assistant") {
    context.events.handle(
      { type: "assistant.delta", turnId: context.native, delta: frame.text },
      context.at,
      context.assistantOffset,
    )
    context.assistantOffset += frame.text.length
  } else if (frame.kind === "thinking") {
    context.events.handle(
      { type: "thinking.delta", turnId: context.native, delta: frame.text },
      context.at,
      context.thinkingOffset,
    )
    context.thinkingOffset += frame.text.length
  } else if (frame.kind === "tool") recoverTool(context, frame)
}

function recoverStep(
  context: RecoveryContext,
  step: KimiTranscriptTurn["steps"][number],
  index: number,
  current: number,
): void {
  const ordinal = step.ordinal ?? index + 1
  if (ordinal < current) return
  context.events.handle(
    { type: "turn.step.started", turnId: context.native, step: ordinal },
    context.at,
  )
  const frames: FrameContext = {
    ...context,
    finishReason: step.finishReason,
    assistantOffset: 0,
    thinkingOffset: 0,
  }
  for (const frame of step.frames) recoverFrame(frames, frame)
  if (step.state === "interrupted") {
    if (step.endReason !== undefined || step.endMessage !== undefined) {
      context.events.handle(
        {
          type: "turn.step.interrupted",
          turnId: context.native,
          step: ordinal,
          reason: step.endReason,
          message: step.endMessage,
        },
        context.at,
      )
    }
    return
  }
  if (step.state === "completed" || step.finishReason !== undefined) {
    context.events.handle(
      {
        type: "turn.step.completed",
        turnId: context.native,
        step: ordinal,
        finishReason: step.finishReason,
      },
      context.at,
    )
  }
}

function endReason(state: KimiTranscriptTurn["state"]): string | undefined {
  if (state === "completed") return "completed"
  if (state === "cancelled") return "cancelled"
  return state === "failed" ? "failed" : undefined
}

/** 用同一公开 transcript 补齐快照水位前的 step，再让快照续接当前 step 的 volatile 尾巴。 */
export function recoverKimiTranscript(
  tracker: KimiTurnTracker,
  events: KimiTurnEvents,
  turn: KimiTranscriptTurn,
  at: number,
): boolean {
  const native = matchingNative(tracker, turn)
  if (native === undefined) return false
  tracker.started({ turnId: native, prompt: turn.prompt })
  const context = { events, native, at }
  const current = tracker.currentStep()
  for (const [index, step] of turn.steps.entries()) recoverStep(context, step, index, current)
  const reason = endReason(turn.state)
  if (reason !== undefined)
    events.handle({ type: "turn.ended", turnId: native, reason, error: turn.error }, at)
  return true
}
