import { defineMessages } from "@switchback/i18n"

/** 侧问问不成的两种情况。 */
export const CLAUDE_ASIDE = defineMessages(
  { unsupported: "这条会话不支持侧问", noAnswer: "引擎没有给出侧问的回答" },
  { unsupported: "This thread doesn't support side questions", noAnswer: "The engine gave no answer to the side question" },
)
