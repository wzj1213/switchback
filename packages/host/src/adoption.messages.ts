import { defineMessages } from "@switchback/i18n"

/** 接管一条引擎自己的会话、只搬了最近一段时的说明。 */
export const ADOPTION = defineMessages(
  {
    trimmed: (total: number, kept: number) =>
      `这条会话有 ${String(total)} 条记录，只搬了最近 ${String(kept)} 条进来。完整的还在引擎那边，它自己看得见。`,
  },
  {
    trimmed: (total, kept) =>
      `This thread has ${String(total)} records; only the latest ${String(kept)} were brought in. The full history is still with the engine, which can see it.`,
  },
)
