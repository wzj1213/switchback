import { defineMessages } from "@switchback/i18n"

/** 思考折叠，以及不是你亲手发的那几种「用户消息」的来源标记（与桌面端同一套说法）。 */
export const ITEM_VIEW = defineMessages(
  {
    thinking: "思考",
    thinkingLive: "思考中…",
    handoff: "历史交接",
    shell: "终端命令",
    goal: "长期目标续跑",
    scheduled: "定时触发",
    once: "单次",
    merged: (n: number) => `合并 ${String(n)} 次`,
    last: "最后一次",
  },
  {
    thinking: "Thinking",
    thinkingLive: "Thinking…",
    handoff: "Handoff note",
    shell: "Terminal command",
    goal: "Goal continuation",
    scheduled: "Scheduled",
    once: "One-time",
    merged: (n) => `${String(n)} runs merged`,
    last: "Last run",
  },
)
