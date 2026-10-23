import { defineMessages } from "@switchback/i18n"

/** 输入框上方那颗「后台 N」。 */
export const ACTIVITY_DOCK = defineMessages(
  { count: (n: number) => `后台 ${String(n)}` },
  { count: (n) => `Background ${String(n)}` },
)
