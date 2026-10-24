import type { Locale } from "@switchback/i18n"

/**
 * 没给语言时用哪一种。和 `@switchback/i18n` 的 `DEFAULT_LOCALE` 同值；
 * 本包零运行时依赖，只按类型引那个包，所以这里自己写一份。
 */
export const FALLBACK_LOCALE: Locale = "zh-CN"
