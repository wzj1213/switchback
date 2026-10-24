import { defineMessages } from "@switchback/i18n"

/** 侧问问不成的几种情况。Kimi 自己报的错优先，原样透传。 */
export const KIMI_ASIDE = defineMessages(
  {
    timeout: "Kimi 侧问在三分钟内没有回答",
    notStarted: (status: string) => `Kimi 没有开始侧问（状态：${status}）`,
    unfinished: "Kimi 侧问没有正常完成",
    noText: "Kimi 侧问没有返回文字",
    closing: "Kimi 会话正在关闭",
  },
  {
    timeout: "Kimi didn't answer the side question within three minutes",
    notStarted: (status) => `Kimi didn't start the side question (status: ${status})`,
    unfinished: "Kimi's side question didn't finish normally",
    noText: "Kimi's side question returned no text",
    closing: "The Kimi thread is closing",
  },
)
