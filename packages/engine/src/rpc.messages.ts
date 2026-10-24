import { defineMessages } from "@switchback/i18n"

/** JSON-RPC 这一层自己说的话。对端报的错原样转述。 */
export const RPC = defineMessages(
  {
    peerError: "对端返回了错误",
    withDetail: (head: string, detail: string) => `${head}：${detail}`,
    closed: (method: string) => `连接已关闭，${method} 未发出`,
  },
  {
    peerError: "The other side returned an error",
    withDetail: (head, detail) => `${head}: ${detail}`,
    closed: (method) => `The connection is closed, so ${method} wasn't sent`,
  },
)
