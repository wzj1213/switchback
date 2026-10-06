import type { TurnStatus } from "@switchback/protocol"
import type { KimiSnapshot } from "./wire.js"

export function kimiMessage(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw
  if (typeof raw !== "object" || raw === null) return undefined
  const message = (raw as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}

export function kimiTurnStatus(reason: string | undefined): TurnStatus {
  if (reason === "completed") return "completed"
  if (reason === "cancelled") return "interrupted"
  return "failed"
}

/** 空闲快照只有在普通 prompt 或 skill activation 已被接受后，才足以证明当前轮真的结束了。 */
export function snapshotCanFinish(accepted: boolean, snapshot: KimiSnapshot): boolean {
  return accepted && !snapshot.session.busy
}

/** 原生 turn id 优先；尚未见到它时才用初始 prompt id 防串轮。 */
export function snapshotMatches(
  native: number | undefined,
  promptId: string | undefined,
  activationAccepted: boolean,
  snapshot: KimiSnapshot,
): boolean {
  const flight = snapshot.in_flight_turn
  if (flight === null) return false
  if (native !== undefined) return native === flight.turn_id
  if (promptId === undefined) return activationAccepted
  const current = flight.current_prompt_id ?? snapshot.session.current_prompt_id ?? undefined
  return current === promptId
}
