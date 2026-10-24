import { defineMessages } from "@switchback/i18n"

/** MCP 工具授权卡上的说法。连接器名、工具名、参数原样显示。 */
export const CODEX_ELICITATION = defineMessages(
  {
    field: (name: string, value: string) => `${name}：${value}`,
    fields: (rows: readonly string[]) => rows.join("，"),
    toolCall: "工具调用",
    wantsTool: (connector: string, operation: string, details: string) =>
      `${connector} 请求调用 ${operation}${details === "" ? "" : `（${details}）`}`,
    wantsAuth: (connector: string) => `${connector} 请求授权`,
  },
  {
    field: (name, value) => `${name}: ${value}`,
    fields: (rows) => rows.join(", "),
    toolCall: "a tool",
    wantsTool: (connector, operation, details) => `${connector} wants to call ${operation}${details === "" ? "" : ` (${details})`}`,
    wantsAuth: (connector) => `${connector} is asking for authorization`,
  },
)
