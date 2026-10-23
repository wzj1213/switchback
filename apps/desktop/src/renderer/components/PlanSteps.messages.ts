import { defineMessages } from "@switchback/i18n"

/** 计划里的每一步。步骤正文是引擎写的，不翻译。 */
export const PLAN_STEPS = defineMessages(
  {
    status: { pending: "未开始", in_progress: "进行中", done: "已完成", dropped: "已放弃" },
    more: (hidden: number, done: number, pending: number) =>
      `… 还有 ${String(hidden)} 条（${String(done)} 已完成 · ${String(pending)} 未开始）`,
  },
  {
    status: { pending: "Not started", in_progress: "In progress", done: "Done", dropped: "Dropped" },
    more: (hidden, done, pending) => `… ${String(hidden)} more (${String(done)} done · ${String(pending)} not started)`,
  },
)
