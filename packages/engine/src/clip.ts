import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLIP } from "./clip.messages.js"

/** 超过 `max` 个字符就截断，另起一行标上「已截断」（跟着界面语言）。 */
export function clip(text: string, max: number, locale: Locale = DEFAULT_LOCALE): string {
  return text.length > max ? `${text.slice(0, max)}\n${CLIP[locale].truncated}` : text
}
