import { count, defineMessages } from "@switchback/i18n"

/** 文件改动的差异块。 */
export const DIFF = defineMessages(
  { reveal: (path: string) => `在访达中显示\n${path}`, more: (n: number) => `还有 ${String(n)} 行` },
  { reveal: (path) => `Show in Finder\n${path}`, more: (n) => `${count(n, "more line")}` },
)
