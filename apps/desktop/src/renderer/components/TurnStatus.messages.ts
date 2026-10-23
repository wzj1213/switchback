import { defineMessages } from "@switchback/i18n"

/** 对话流末尾那行运行状态。 */
export const TURN_STATUS = defineMessages(
  {
    tokensTip: "当前思考块的近似值，不是最终用量",
    tokens: (n: string) => `约 ${n} tokens`,
    reconnecting: "连接断了，正在接回…",
  },
  {
    tokensTip: "An estimate for the current thinking block, not final usage",
    tokens: (n) => `~${n} tokens`,
    reconnecting: "Connection lost. Reconnecting…",
  },
)
