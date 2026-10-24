import { count, defineMessages } from "@switchback/i18n"

/** 正文上方那条计划进度。步骤正文是引擎写的，不翻译。 */
export const PLAN_BAR = defineMessages(
  {
    total: (total: number) => `共 ${String(total)} 步`,
    at: (index: number, total: number) => `第 ${String(index)} / ${String(total)} 步`,
    current: "当前计划",
  },
  {
    total: (total) => count(total, "step"),
    at: (index, total) => `Step ${String(index)} of ${String(total)}`,
    current: "Current plan",
  },
)
