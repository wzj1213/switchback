import type { ErrorItem, Item, TurnId, UserMessageItem } from "@omni/protocol"
import { kimiActivation, kimiActivationItem, kimiTranscriptActivation } from "./activation.js"
import { kimiCronOrigin, kimiCronPrompt } from "./cron.js"
import { isKimiGoalContinuation } from "./goal-continuation.js"
import { planSteps } from "./plan.js"
import { kimiShellHistoryItem } from "./shell-history.js"
import {
  isKimiTruncatedTool,
  kimiMaxTokensMessage,
  kimiStepInterruptionMessage,
  kimiTruncatedTranscriptTool,
} from "./step-outcome.js"
import { transcriptTool } from "./tool.js"
import type {
  KimiTranscriptEntry,
  KimiTranscriptFrame,
  KimiTranscriptMarker,
  KimiTranscriptPage,
  KimiTranscriptTurn,
} from "./wire.js"

export const TRANSCRIPT_ITEM_MAX = 1500

function atOf(turn: KimiTranscriptTurn): number {
  const at = turn.endedAt === undefined ? 0 : new Date(turn.endedAt).getTime()
  return Number.isNaN(at) ? 0 : at
}

function frameItem(frame: KimiTranscriptFrame, turnId: TurnId, at: number): Item {
  if (frame.kind === "text") {
    return frame.role === "user"
      ? { id: frame.frameId, turnId, at, kind: "user_message", text: frame.text }
      : { id: frame.frameId, turnId, at, kind: "agent_message", text: frame.text, complete: true }
  }
  if (frame.kind === "thinking") {
    return { id: frame.frameId, turnId, at, kind: "reasoning", text: frame.text, complete: true }
  }
  if (frame.kind === "tool") return transcriptTool(frame, turnId, at)
  if (frame.level !== "error") {
    return {
      id: frame.frameId,
      turnId,
      at,
      kind: "notice",
      message: frame.message,
      level: frame.level === "warning" ? "warning" : "info",
    }
  }
  return {
    id: frame.frameId,
    turnId,
    at,
    kind: "error",
    message: frame.message,
    fatal: frame.level === "error",
    ...(frame.detail === undefined ? {} : { detail: String(frame.detail) }),
  }
}

function promptItem(
  turn: KimiTranscriptTurn,
  turnId: TurnId,
  at: number,
): UserMessageItem | undefined {
  if (isKimiGoalContinuation(turn.origin)) {
    return {
      id: `${turnId}-goal-continuation`,
      turnId,
      at,
      kind: "user_message",
      text: "",
      origin: { kind: "goal_continuation" },
    }
  }
  if (turn.prompt === undefined || turn.prompt === "") return undefined
  if (kimiActivation(turn.origin)?.trigger === "user-slash") return undefined
  const origin = kimiCronOrigin(turn.origin)
  return {
    id: `${turnId}-prompt`,
    turnId,
    at,
    kind: "user_message",
    text: origin === undefined ? turn.prompt : kimiCronPrompt(turn.prompt),
    ...(origin === undefined ? {} : { origin }),
  }
}

interface TranscriptContext {
  out: Item[]
  turnId: TurnId
  at: number
}

function appendFrame(
  context: TranscriptContext,
  frame: KimiTranscriptFrame,
  planAt?: number,
): number | undefined {
  const steps = frame.kind === "tool" ? planSteps(frame.display) : undefined
  if (steps === undefined) {
    context.out.push(frameItem(frame, context.turnId, context.at))
    return planAt
  }
  if (steps.length === 0) return planAt
  const plan = {
    id: `${context.turnId}-plan`,
    turnId: context.turnId,
    at: context.at,
    kind: "plan" as const,
    steps,
  }
  if (planAt === undefined) {
    context.out.push(plan)
    return context.out.length - 1
  }
  context.out[planAt] = plan
  return planAt
}

function stepInterruption(step: KimiTranscriptTurn["steps"][number]): string | undefined {
  if (
    step.state !== "interrupted" ||
    (step.endReason === undefined && step.endMessage === undefined)
  ) {
    return undefined
  }
  return kimiStepInterruptionMessage({ reason: step.endReason, message: step.endMessage })
}

function appendStep(
  context: TranscriptContext,
  step: KimiTranscriptTurn["steps"][number],
  index: number,
  planAt?: number,
): number | undefined {
  let partialTools = 0
  for (const frame of step.frames) {
    if (!isKimiTruncatedTool(step.finishReason, frame)) {
      planAt = appendFrame(context, frame, planAt)
      continue
    }
    partialTools += 1
    context.out.push(
      kimiTruncatedTranscriptTool(
        frame as Extract<KimiTranscriptFrame, { kind: "tool" }>,
        context.turnId,
        context.at,
      ),
    )
  }
  if (step.finishReason === "max_tokens") {
    context.out.push({
      id: `${context.turnId}-max-tokens-${String(index + 1)}`,
      turnId: context.turnId,
      at: context.at,
      kind: "notice",
      message: kimiMaxTokensMessage(partialTools > 0),
      level: "warning",
    })
  }
  const interruption = stepInterruption(step)
  if (interruption !== undefined) {
    context.out.push({
      id: `${context.turnId}-step-interrupted-${String(index + 1)}`,
      turnId: context.turnId,
      at: context.at,
      kind: "error",
      message: interruption,
      fatal: false,
    })
  }
  return planAt
}

function takeTurn(turn: KimiTranscriptTurn): readonly Item[] {
  const at = atOf(turn)
  const turnId = `kimi-history-${turn.turnId}`
  const out: Item[] = []
  const context = { out, turnId, at }
  let planIndex: number | undefined
  const shell = kimiShellHistoryItem(turn, turnId, at)
  const prompt = shell === undefined ? promptItem(turn, turnId, at) : undefined
  if (shell !== undefined) out.push(shell)
  else if (prompt !== undefined) out.push(prompt)
  for (const [stepIndex, step] of turn.steps.entries()) {
    planIndex = appendStep(context, step, stepIndex, planIndex)
  }
  if (turn.error !== undefined && !out.some((item) => item.kind === "error" && item.fatal)) {
    const error: ErrorItem = {
      id: `${turnId}-error`,
      turnId,
      at,
      kind: "error",
      message: turn.error,
      fatal: true,
    }
    out.push(error)
  }
  return out
}

function isTurn(entry: KimiTranscriptEntry): entry is KimiTranscriptTurn {
  return entry.kind === "turn" && Array.isArray((entry as { steps?: unknown }).steps)
}

function isMarker(entry: KimiTranscriptEntry): entry is KimiTranscriptMarker {
  const value = entry as Partial<KimiTranscriptMarker>
  return (
    entry.kind === "marker" &&
    typeof value.markerId === "string" &&
    typeof value.marker === "string"
  )
}

function nextTurn(
  entries: readonly KimiTranscriptEntry[],
  from: number,
  boundary?: KimiTranscriptTurn,
): KimiTranscriptTurn | undefined {
  for (let index = from + 1; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry !== undefined && isTurn(entry)) return entry
  }
  return boundary
}

function markerAt(marker: KimiTranscriptMarker, turn: KimiTranscriptTurn): number {
  const raw = marker.at === undefined ? Number.NaN : new Date(marker.at).getTime()
  return Number.isNaN(raw) ? atOf(turn) : raw
}

function appendPersistedInterruption(
  out: Item[],
  marker: KimiTranscriptMarker,
  turn: KimiTranscriptTurn | undefined,
): boolean {
  if (marker.marker !== "interruption") return false
  const payload = marker.payload
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return true
  const raw = payload as { turnId?: unknown; reason?: unknown }
  const native = raw.turnId
  if (
    !Number.isSafeInteger(native) ||
    Number(native) < 0 ||
    raw.reason !== "user_cancelled" ||
    turn?.turnId !== `t${String(native)}` ||
    turn.steps.some((step) => stepInterruption(step) !== undefined)
  ) {
    return true
  }
  const turnId = `kimi-history-${turn.turnId}`
  out.push({
    id: `${turnId}-user-interrupted`,
    turnId,
    at: markerAt(marker, turn),
    kind: "error",
    message: "Interrupted by user",
    fatal: false,
  })
  return true
}

export function toTranscript(
  page: KimiTranscriptPage,
  boundary?: KimiTranscriptTurn,
): { items: readonly Item[]; total: number } {
  const all: Item[] = []
  let previous: KimiTranscriptTurn | undefined
  for (const [index, entry] of page.items.entries()) {
    if (isTurn(entry)) {
      all.push(...takeTurn(entry))
      previous = entry
      continue
    }
    if (!isMarker(entry)) continue
    if (appendPersistedInterruption(all, entry, previous)) continue
    const activation = kimiTranscriptActivation(entry)
    if (activation === undefined) continue
    const target =
      activation.trigger === "user-slash" ? nextTurn(page.items, index, boundary) : previous
    if (target === undefined) continue
    all.push(
      kimiActivationItem(activation, `kimi-history-${target.turnId}`, markerAt(entry, target)),
    )
  }
  const items = all.length <= TRANSCRIPT_ITEM_MAX ? all : all.slice(-TRANSCRIPT_ITEM_MAX)
  const total = all.length + (page.has_more ? 1 : 0)
  return { items, total }
}
