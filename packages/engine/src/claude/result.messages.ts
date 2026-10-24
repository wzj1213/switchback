import { defineMessages } from "@switchback/i18n"

/** 轮次或子任务收工时还没报结果的那次工具调用。 */
export const CLAUDE_RESULT = defineMessages(
  {
    noToolResult: "Claude 在轮次结束前没有报告这次工具调用的结果。",
    noSubtaskResult: "Claude 在子任务结束前没有报告这次工具调用的结果。",
  },
  {
    noToolResult: "Claude didn't report the result of this tool call before the turn ended.",
    noSubtaskResult: "Claude didn't report the result of this tool call before the subtask ended.",
  },
)
