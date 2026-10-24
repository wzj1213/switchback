import { defineMessages } from "@switchback/i18n"

/** 从这里重来时找不到分叉点。会话 id 原样显示。 */
export const CLAUDE_FORK = defineMessages(
  {
    noSession: (handle: string) => `找不到 Claude 的会话记录：${handle}`,
    tooFew: "这条会话里没有那么多轮，分不出这个分叉点",
  },
  {
    noSession: (handle) => `Can't find Claude's session record: ${handle}`,
    tooFew: "This thread doesn't have that many turns, so this fork point can't be found",
  },
)
