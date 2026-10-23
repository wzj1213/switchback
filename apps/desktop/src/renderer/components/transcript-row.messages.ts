import { defineMessages } from "@switchback/i18n"

/** 转录区一行上的动作。 */
export const TRANSCRIPT_ROW = defineMessages(
  {
    rewind: "从这里重来",
    rewindTip: "从这里重来：新开会话，只带这轮之前的上下文",
    reuse: "改一改再发",
  },
  {
    rewind: "Restart from here",
    rewindTip: "Restart from here: opens a new thread with only the context before this turn",
    reuse: "Edit and resend",
  },
)
