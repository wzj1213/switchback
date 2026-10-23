import { count, defineMessages } from "@switchback/i18n"

/** 折起来的粘贴块上那一行。 */
export const COMPOSER_BLOCKS = defineMessages(
  {
    paste: (lines: number) => `粘贴文本 · ${String(lines)} 行`,
    pasteSize: (lines: number, kb: string) => `粘贴文本 · ${String(lines)} 行 · ${kb} KB`,
  },
  {
    paste: (lines) => `Pasted text · ${count(lines, "line")}`,
    pasteSize: (lines, kb) => `Pasted text · ${count(lines, "line")} · ${kb} KB`,
  },
)
