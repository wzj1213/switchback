import type { Event, TurnId } from "@switchback/protocol"
import type { KimiPayload } from "./wire.js"
import { kimiNativePartId } from "./native-part.js"

export function kimiRetryEvent(
  payload: KimiPayload,
  turnId: TurnId,
  state: { started: boolean; part: number },
  at: number,
): Event {
  const message = typeof payload.errorMessage === "string" ? payload.errorMessage : "Kimi 正在重试这一轮"
  return {
    type: state.started ? "item.updated" : "item.started",
    at,
    item: { id: kimiNativePartId("kimi-retry", turnId, state.part), turnId, at, kind: "error", message, fatal: false },
  }
}
