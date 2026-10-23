import { defineMessages } from "@switchback/i18n"

/** 引用进输入框的那段改动，芯片上那行字。 */
export const REVIEW_QUOTE = defineMessages(
  { label: (where: string) => `引用 ${where}` },
  { label: (where) => `Quote ${where}` },
)
