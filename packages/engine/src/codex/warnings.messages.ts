import { defineMessages } from "@switchback/i18n"

/** codex 交给客户端显示的 warning：位置那一行的前缀。正文原样显示。 */
export const CODEX_WARNINGS = defineMessages(
  { location: (where: string) => `位置：${where}` },
  { location: (where) => `Location: ${where}` },
)
