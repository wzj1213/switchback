import { defineMessages } from "@switchback/i18n"

/** 用户自己的 ask 规则强制弹卡时的理由。规则原文照抄。 */
export const CLAUDE_PERMISSION = defineMessages(
  { askRule: (rule: string) => `Claude 设置里的 ask 规则要求逐项确认：${rule}` },
  { askRule: (rule) => `An ask rule in Claude's settings requires confirming each call: ${rule}` },
)
