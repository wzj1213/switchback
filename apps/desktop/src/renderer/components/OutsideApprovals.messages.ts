import { defineMessages } from "@switchback/i18n"

/** 主轮之外（后台任务、子 agent）在等你批的请求。 */
export const OUTSIDE_APPROVALS = defineMessages(
  {
    unknownOrigin: "后台来的请求 · 来源未标明",
    task: "后台任务",
    subagent: "子 agent",
    justNow: "刚刚",
    waitedMinutes: (n: number) => `已等 ${String(n)} 分钟`,
    waitedHours: (n: number) => `已等 ${String(n)} 小时`,
    label: "后台在等你确认",
    confirmLabel: (summary: string) => `需要你确认：${summary}`,
    confirm: "需要你确认",
    alwaysTip: (hint: string) => `始终允许：${hint}`,
    always: "始终允许",
    allowSession: "允许此对话",
    allowSessionMain: "允许此对话（主对话也算）",
    deny: "拒绝",
    once: "允许一次",
  },
  {
    unknownOrigin: "Background request · source not given",
    task: "Background task",
    subagent: "Subagent",
    justNow: "just now",
    waitedMinutes: (n) => `waiting ${String(n)}m`,
    waitedHours: (n) => `waiting ${String(n)}h`,
    label: "Background work waiting for your approval",
    confirmLabel: (summary) => `Needs your approval: ${summary}`,
    confirm: "Needs your approval",
    alwaysTip: (hint) => `Always allow: ${hint}`,
    always: "Always allow",
    allowSession: "Allow for this thread",
    allowSessionMain: "Allow for this thread (the main conversation too)",
    deny: "Deny",
    once: "Allow once",
  },
)
