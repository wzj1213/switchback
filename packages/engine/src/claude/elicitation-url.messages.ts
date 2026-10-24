import { defineMessages } from "@switchback/i18n"

/** MCP 要你去一个网址：提醒与按钮。网址原样显示。 */
export const CLAUDE_ELICITATION_URL = defineMessages(
  {
    plainHttp: "这不是 HTTPS 地址，提交敏感信息前请确认连接是否可信",
    punycode: "域名包含 Punycode（xn--），请仔细核对，避免相似域名欺骗",
    join: (warnings: readonly string[]) => warnings.join("；"),
    question: "是否同意前往这个地址？",
    accept: "我已核对地址，同意继续",
  },
  {
    plainHttp: "This isn't an HTTPS address; make sure the connection is trustworthy before submitting anything sensitive",
    punycode: "The domain contains Punycode (xn--); check it carefully to avoid look-alike domains",
    join: (warnings) => warnings.join("; "),
    question: "Go to this address?",
    accept: "I've checked the address; continue",
  },
)
