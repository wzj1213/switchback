import { defineMessages } from "@switchback/i18n"

/** 宿主退回来的那句话。提示正文是宿主写的。 */
export const REMOTE_FRAMES = defineMessages(
  { unsent: (text: string, returned: string) => `${text}\n没发出去的那句：${returned}` },
  { unsent: (text, returned) => `${text}\nThe message that wasn't sent: ${returned}` },
)
