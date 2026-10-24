import { defineMessages } from "@switchback/i18n"

/** Kimi Web API 回了读不懂的东西。它自己报的错（`msg`）原样透传，不经过这里。 */
export const KIMI_HTTP = defineMessages(
  {
    unparseable: (status: number) => `Kimi Web API 返回了无法解析的响应（HTTP ${String(status)}）`,
    badEnvelope: (status: number) => `Kimi Web API 返回了错误的 envelope（HTTP ${String(status)}）`,
  },
  {
    unparseable: (status) => `The Kimi Web API returned a response that couldn't be parsed (HTTP ${String(status)})`,
    badEnvelope: (status) => `The Kimi Web API returned a malformed envelope (HTTP ${String(status)})`,
  },
)
