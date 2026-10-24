import { defineMessages } from "@switchback/i18n"

/** 轮次本身的几句：撞上还在跑的一轮、工具调用没等到结果、重试时 Kimi 没给理由。 */
export const KIMI_TURN = defineMessages(
  {
    busy: "Kimi 还有一轮正在运行",
    noToolResult: "Kimi 在轮次结束前没有报告这次工具调用的结果。",
    retrying: "Kimi 正在重试这一轮",
  },
  {
    busy: "Kimi still has a turn running",
    noToolResult: "Kimi didn't report the result of this tool call before the turn ended.",
    retrying: "Kimi is retrying this turn",
  },
)
