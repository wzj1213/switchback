import type { ErrorItem, Item, TurnId } from "@omni/protocol"
import { planSteps } from "./plan.js"
import { transcriptTool } from "./tool.js"
import type { KimiTranscriptEntry, KimiTranscriptFrame, KimiTranscriptPage, KimiTranscriptTurn } from "./wire.js"

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

function takeTurn(turn: KimiTranscriptTurn): readonly Item[] {
  const at = atOf(turn)
  const turnId = `kimi-history-${turn.turnId}`
  const out: Item[] = []
  let planIndex: number | undefined
  if (turn.prompt !== undefined && turn.prompt !== "") {
    out.push({ id: `${turnId}-prompt`, turnId, at, kind: "user_message", text: turn.prompt })
  }
  for (const frame of turn.steps.flatMap((step) => step.frames)) {
    const steps = frame.kind === "tool" ? planSteps(frame.display) : undefined
    if (steps === undefined) out.push(frameItem(frame, turnId, at))
    else if (steps.length > 0) {
      const plan = { id: `${turnId}-plan`, turnId, at, kind: "plan" as const, steps }
      if (planIndex === undefined) {
        planIndex = out.length
        out.push(plan)
      } else out[planIndex] = plan
    }
  }
  if (turn.error !== undefined && !out.some((item) => item.kind === "error")) {
    const error: ErrorItem = { id: `${turnId}-error`, turnId, at, kind: "error", message: turn.error, fatal: true }
    out.push(error)
  }
  return out
}

function isTurn(entry: KimiTranscriptEntry): entry is KimiTranscriptTurn {
  return entry.kind === "turn" && Array.isArray((entry as { steps?: unknown }).steps)
}

export function toTranscript(page: KimiTranscriptPage): { items: readonly Item[]; total: number } {
  const all = page.items.filter(isTurn).flatMap(takeTurn)
  const items = all.length <= TRANSCRIPT_ITEM_MAX ? all : all.slice(-TRANSCRIPT_ITEM_MAX)
  const total = all.length + (page.has_more ? 1 : 0)
  return { items, total }
}
