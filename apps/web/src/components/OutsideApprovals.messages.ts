import { defineMessages } from "@switchback/i18n"

/** 主轮之外（后台任务、子 agent）在等你批的请求（与桌面端同一套说法）。 */
export const OUTSIDE_APPROVALS = defineMessages(
  {
    unknownOrigin: "后台来的请求 · 来源未标明",
    task: "后台任务",
    subagent: "子 agent",
    justNow: "刚刚",
    waitedMinutes: (n: number) => `已等 ${String(n)} 分钟`,
    waitedHours: (n: number) => `已等 ${String(n)} 小时`,
    label: "后台在等你确认",
  },
  {
    unknownOrigin: "Background request · source not given",
    task: "Background task",
    subagent: "Subagent",
    justNow: "just now",
    waitedMinutes: (n) => `waiting ${String(n)}m`,
    waitedHours: (n) => `waiting ${String(n)}h`,
    label: "Background work waiting for your approval",
  },
)
