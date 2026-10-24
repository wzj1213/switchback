import { defineMessages } from "@switchback/i18n"

/** Claude 这边的 MCP 服务器要授权、没起来时的横幅。服务器名与原因原样显示。 */
export const CLAUDE_MCP = defineMessages(
  {
    needsAuth: (name: string) => `MCP 服务器「${name}」需要授权；请在 Claude 中完成登录后重试`,
    failed: (name: string, detail: string | undefined) =>
      `MCP 服务器「${name}」没起来，它提供的工具当前不可用${detail === undefined ? "" : `：${detail}`}`,
  },
  {
    needsAuth: (name) => `The MCP server “${name}” needs authorization; sign in from Claude and try again`,
    failed: (name, detail) => `The MCP server “${name}” didn't start, so its tools aren't available${detail === undefined ? "" : `: ${detail}`}`,
  },
)
