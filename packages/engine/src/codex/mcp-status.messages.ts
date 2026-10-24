import { defineMessages } from "@switchback/i18n"

/** MCP 服务器没起来时的横幅。服务器名与原因原样显示。 */
export const CODEX_MCP = defineMessages(
  {
    reauth: "授权已失效，需要重新连接这台 MCP 服务器",
    failed: (name: string, why: string) => `MCP 服务器「${name}」没起来，它提供的工具这一会话都用不了：${why}`,
  },
  {
    reauth: "Its authorization expired; reconnect this MCP server",
    failed: (name, why) => `The MCP server “${name}” didn't start, so its tools aren't available in this thread: ${why}`,
  },
)
