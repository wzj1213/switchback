import { defineMessages } from "@switchback/i18n"

/** MCP 那边说外部那一步办完了。服务名与 id 原样显示。 */
export const CLAUDE_ELICITATION_DONE = defineMessages(
  { done: (server: string, id: string) => `MCP 服务“${server}”已确认外部交互完成（${id}）` },
  { done: (server, id) => `The MCP server “${server}” confirmed the external step is done (${id})` },
)
