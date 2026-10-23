import { defineMessages } from "@switchback/i18n"

/** 转录区。 */
export const TRANSCRIPT = defineMessages(
  {
    region: (title: string) => `对话记录：${title}`,
    trimmed: "更早的内容没有加载：这条会话太长，远程只带了后面这一段。完整记录在那台机器上。",
    toBottom: "回到底部",
  },
  {
    region: (title) => `Conversation: ${title}`,
    trimmed: "Earlier messages aren't loaded: this thread is too long, so remote access only brought the latest part. The full history is on the other Mac.",
    toBottom: "Jump to bottom",
  },
)
