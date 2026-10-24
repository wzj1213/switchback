import { defineMessages } from "@switchback/i18n"

/** Claude API 自己在重试时的那一条。 */
export const CLAUDE_RETRY = defineMessages(
  { retrying: (attempt: number, max: number, delay: number) => `Claude API 正在重试（${String(attempt)}/${String(max)}，${String(delay)}ms 后）` },
  { retrying: (attempt, max, delay) => `The Claude API is retrying (${String(attempt)}/${String(max)}, in ${String(delay)}ms)` },
)
