import type { ActivityMetric } from "../../shared/activity.js"
import { defineMessages } from "@switchback/i18n"

const UNIT_ZH: Readonly<Record<ActivityMetric, string>> = { turns: "轮", asks: "条消息", tools: "次工具调用", tokens: "个 token" }
const UNIT_EN: Readonly<Record<ActivityMetric, readonly [string, string]>> = {
  turns: ["turn", "turns"],
  asks: ["message", "messages"],
  tools: ["tool call", "tool calls"],
  tokens: ["token", "tokens"],
}
const WEEKDAYS_ZH = ["一", "", "三", "", "五", "", "日"] as const
const WEEKDAYS_EN = ["Mon", "", "Wed", "", "Fri", "", "Sun"] as const

/** 活动热力图。 */
export const ACTIVITY_HEAT = defineMessages(
  {
    metric: { turns: "轮次", asks: "消息", tools: "工具", tokens: "Token" },
    mode: { daily: "每日", weekly: "每周", total: "累计" },
    unit: (metric: ActivityMetric, _n: number) => UNIT_ZH[metric],
    weekday: (index: number): string => WEEKDAYS_ZH[index] ?? "",
    title: "按天分布",
    less: "少",
    more: "多",
    hint: { weekly: "每一格显示它所在那一周的合计", total: "每一格显示到那天为止的累计", daily: "把鼠标放在格子上看那天做了什么" },
    scope: { weekly: "那一周", total: "到这天累计", daily: "" },
    idle: "没动",
    nothingElse: "只有这一项",
    withDetail: (head: string, main: string, detail: string) => `${head} · ${main}（${detail}）`,
  },
  {
    metric: { turns: "Turns", asks: "Messages", tools: "Tools", tokens: "Tokens" },
    mode: { daily: "Daily", weekly: "Weekly", total: "Running total" },
    unit: (metric, n) => UNIT_EN[metric][n === 1 ? 0 : 1],
    weekday: (index) => WEEKDAYS_EN[index] ?? "",
    title: "By day",
    less: "Less",
    more: "More",
    hint: { weekly: "Each cell shows its week's total", total: "Each cell shows the running total up to that day", daily: "Hover over a cell to see that day" },
    scope: { weekly: "that week", total: "running total", daily: "" },
    idle: "no activity",
    nothingElse: "nothing else",
    withDetail: (head, main, detail) => `${head} · ${main} (${detail})`,
  },
)
