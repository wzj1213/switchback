import { count, defineMessages } from "@switchback/i18n"

/** 对话流里那张计划卡。 */
export const PLAN_CARD = defineMessages(
  {
    title: "计划",
    count: (total: number, done: number) => `${String(total)} 步${done === 0 ? "" : `（${String(done)} 已完成）`}`,
  },
  {
    title: "Plan",
    count: (total, done) => `${count(total, "step")}${done === 0 ? "" : ` (${String(done)} done)`}`,
  },
)
