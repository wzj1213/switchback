import { defineMessages } from "@switchback/i18n"

/** 引擎报的长期目标那一条。目标正文是引擎写的，不翻译。 */
export const GOAL_BAR = defineMessages(
  {
    status: {
      active: "目标进行中",
      paused: "目标已暂停",
      blocked: "目标受阻",
      usage_limited: "用量受限",
      budget_limited: "预算已用尽",
      complete: "目标已完成",
    },
    seconds: (s: number) => `${String(s)} 秒`,
    minutes: (min: number) => `${String(min)} 分钟`,
    hours: (h: number, min: number) => `${String(h)} 小时${min === 0 ? "" : ` ${String(min)} 分钟`}`,
    used: (n: string) => `已用 ${n}`,
    ran: (time: string) => `已运行 ${time}`,
  },
  {
    status: {
      active: "Goal in progress",
      paused: "Goal paused",
      blocked: "Goal blocked",
      usage_limited: "Usage limit reached",
      budget_limited: "Budget used up",
      complete: "Goal complete",
    },
    seconds: (s) => `${String(s)}s`,
    minutes: (min) => `${String(min)}m`,
    hours: (h, min) => `${String(h)}h${min === 0 ? "" : ` ${String(min)}m`}`,
    used: (n) => `${n} used`,
    ran: (time) => `running for ${time}`,
  },
)
