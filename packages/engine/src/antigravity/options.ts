import type { Trust } from "@switchback/protocol"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { Unsupported } from "../unsupported.js"
import { AGY_OPTIONS } from "./options.messages.js"

export interface TurnOptions {
  trust: Trust
  conversation?: string
  model?: string
  /** 只读档被拒时那句话用哪种语言。缺省中文。 */
  locale?: Locale
}

export function assertTrust(trust: Trust, locale: Locale = DEFAULT_LOCALE): void {
  if (trust === "read-only") throw new Unsupported(AGY_OPTIONS[locale].readOnly)
}

export function turnArgs(options: TurnOptions): string[] {
  assertTrust(options.trust, options.locale)
  const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--mode", "accept-edits"]
  if (options.trust === "full") args.push("--dangerously-skip-permissions")
  if (options.conversation !== undefined) args.push("--conversation", options.conversation)
  if (options.model !== undefined) args.push("--model", options.model)
  return args
}
