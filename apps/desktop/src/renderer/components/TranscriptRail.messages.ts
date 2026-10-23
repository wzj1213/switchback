import { defineMessages } from "@switchback/i18n"

/** 转录区左缘按提问跳转的那条导航。 */
export const TRANSCRIPT_RAIL = defineMessages(
  { nav: "按提问跳转", jump: (title: string) => `跳到这一问：${title}` },
  { nav: "Jump to a question", jump: (title) => `Jump to: ${title}` },
)
