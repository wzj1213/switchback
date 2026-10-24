import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import type { StartRequest } from "./contract.js"

/** 适配器说话用的语言：`StartRequest.locale` 现读，缺省中文。 */
export function localeOf(req: Pick<StartRequest, "locale">): Locale {
  return req.locale?.() ?? DEFAULT_LOCALE
}
