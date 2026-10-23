import { count, defineMessages } from "@switchback/i18n"

/** 输入框上方那颗计划胶囊与它的浮层。 */
export const PLAN_PANEL = defineMessages(
  {
    steps: (total: number) => `· ${String(total)} 步`,
    total: (total: number) => `共 ${String(total)} 步`,
    at: (index: number, total: number) => `第 ${String(index)} 步，共 ${String(total)} 步`,
    aria: (where: string, step: string) => `计划：${where}。${step}`,
    current: "当前计划",
    escToClose: "Esc 收起",
    clickToPin: "点一下钉住",
    dismiss: "本会话收起计划",
  },
  {
    steps: (total) => `· ${count(total, "step")}`,
    total: (total) => count(total, "step"),
    at: (index, total) => `Step ${String(index)} of ${String(total)}`,
    aria: (where, step) => `Plan: ${where}. ${step}`,
    current: "Current plan",
    escToClose: "Esc to close",
    clickToPin: "Click to pin",
    dismiss: "Hide the plan in this thread",
  },
)
