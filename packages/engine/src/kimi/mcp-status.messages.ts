import { defineMessages } from "@switchback/i18n"

/** 好几个 MCP 服务一起出问题时怎么连起来。每一条是 Kimi 自己 TUI 的原文，不翻译。 */
export const KIMI_MCP = defineMessages(
  { join: (parts: readonly string[]) => parts.join("；") },
  { join: (parts) => parts.join("; ") },
)
