import type { Event, TurnId } from "@switchback/protocol"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import type { KimiPayload } from "./wire.js"
import { kimiNativePartId } from "./native-part.js"
import { KIMI_TURN } from "./turn.messages.js"

/** 重试那一行说什么：Kimi 给了原因就照它说，没给才用这一句。 */
export function kimiRetryMessage(payload: KimiPayload, locale: Locale = DEFAULT_LOCALE): string {
  return typeof payload.errorMessage === "string" ? payload.errorMessage : KIMI_TURN[locale].retrying
}

export function kimiRetryEvent(
  message: string,
  turnId: TurnId,
  state: { started: boolean; part: number },
  at: number,
): Event {
  return {
    type: state.started ? "item.updated" : "item.started",
    at,
    item: { id: kimiNativePartId("kimi-retry", turnId, state.part), turnId, at, kind: "error", message, fatal: false },
  }
}
