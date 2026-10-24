import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { KIMI_DISCONNECT } from "./disconnect.messages.js"
import type { KimiDisconnect } from "./stream.js"

function closeNote(code: number | undefined, reason: string | undefined, m: (typeof KIMI_DISCONNECT)[Locale]): string {
  const said = [code === undefined ? "" : String(code), reason ?? ""].filter((part) => part !== "").join(" ")
  return said === "" ? "" : m.note(said)
}

/**
 * 断开原因的一句话。照实说是谁断的、对面给了什么关闭码——
 * 这句话会进 `engine.status` 的 detail，也就进了主进程日志，下回排查靠的就是它。
 */
export function disconnectText(cause: KimiDisconnect, locale: Locale = DEFAULT_LOCALE): string {
  const m = KIMI_DISCONNECT[locale]
  if (cause.kind === "closed") return m.closed(closeNote(cause.code, cause.reason, m))
  if (cause.kind === "resync") return m.resync(cause.by)
  return m.error(cause.message)
}
