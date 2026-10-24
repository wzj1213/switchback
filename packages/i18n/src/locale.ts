/**
 * 界面语言。只有两种：**中文是默认**，英文给仓库外的读者。
 *
 * 加第三种语言要改这里，并给每一份 `*.messages.ts` 补一版——`defineMessages`
 * 会让漏掉的那一份在类型检查里报出来。
 */
export type Locale = "zh-CN" | "en"

export const LOCALES: readonly Locale[] = ["zh-CN", "en"]

export const DEFAULT_LOCALE: Locale = "zh-CN"

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/**
 * 每种语言**用它自己的文字**怎么称呼自己。选语言的地方照这个显示：
 * 切到一种看不懂的语言之后，还得认得出切回去的那一项。
 */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { "zh-CN": "简体中文", en: "English" }

/** 给 `Intl.*`、`<html lang>` 与 Electron 的 `--lang` 用的 BCP 47 标签。 */
export function langTag(locale: Locale): string {
  return locale === "en" ? "en-US" : "zh-CN"
}
