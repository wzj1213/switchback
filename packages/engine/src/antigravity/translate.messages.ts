import { defineMessages } from "@switchback/i18n"

/** 结果帧没给原因、工具没收到结束事件时的回落。它自己报的错优先，原样显示。 */
export const AGY_TRANSLATE = defineMessages(
  {
    badStatus: (status: string) => `Antigravity 返回 ${status}；当前轮次无法继续`,
    noStatus: "缺少状态",
    noToolEnd: "Antigravity 未返回这个工具的结束事件",
  },
  {
    badStatus: (status) => `Antigravity returned ${status}; this turn can't continue`,
    noStatus: "no status",
    noToolEnd: "Antigravity didn't send the end event for this tool",
  },
)
