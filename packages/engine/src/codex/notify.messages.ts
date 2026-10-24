import { defineMessages } from "@switchback/i18n"

/** 通知层补的两句：工具调用没报结果、报错没有描述。 */
export const CODEX_NOTIFY = defineMessages(
  {
    noToolResult: "Codex 在轮次结束前没有报告这次工具调用的结果。",
    noDescription: "codex 报了一个没有描述的错误",
  },
  {
    noToolResult: "Codex didn't report the result of this tool call before the turn ended.",
    noDescription: "codex reported an error without a description",
  },
)
