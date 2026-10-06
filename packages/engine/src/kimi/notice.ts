import type { ErrorItem, NoticeItem, TurnId } from "@switchback/protocol"
import { kimiMessage } from "./turn-state.js"
import type { KimiPayload } from "./wire.js"

export function kimiNotice(
  payload: KimiPayload,
  turnId: TurnId,
  at: number,
  seq: number,
): ErrorItem | NoticeItem | undefined {
  const message = payload.message ?? kimiMessage(payload.error)
  if (message === undefined) return undefined
  const suffix = `${turnId}-${String(at)}-${String(seq)}`
  if (payload.type === "warning") {
    return { id: `kimi-warning-${suffix}`, turnId, at, kind: "notice", message, level: "warning" }
  }
  return {
    id: `kimi-error-${suffix}`,
    turnId,
    at,
    kind: "error",
    message,
    fatal: payload.retryable !== true,
  }
}
