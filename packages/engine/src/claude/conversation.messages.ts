import { defineMessages } from "@switchback/i18n"

/** Claude 自己清空上下文之后在转录区留的那一条。 */
export const CLAUDE_CONVERSATION = defineMessages(
  { cleared: "Claude 已清空上下文；上方记录仍保留供你查看，但后续回答不会再读取它。" },
  { cleared: "Claude cleared its context. The record above stays for you to read, but later answers won't use it." },
)
