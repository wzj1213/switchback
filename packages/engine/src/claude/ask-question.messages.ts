import { defineMessages } from "@switchback/i18n"

/** Claude 问你的问题：回落的「其他」与补充说明。问题与选项是 Claude 写的，不翻译。 */
export const CLAUDE_ASK = defineMessages(
  { other: "其他", writeAnswer: "写下你的答案", note: "补充说明（可选）", addContext: "可选：补充上下文" },
  { other: "Other", writeAnswer: "Write your answer", note: "Notes (optional)", addContext: "Optional: add context" },
)
