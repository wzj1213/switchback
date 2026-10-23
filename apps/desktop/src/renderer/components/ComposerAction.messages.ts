import { defineMessages } from "@switchback/i18n"

/** 输入框右下角那颗键。 */
export const COMPOSER_ACTION = defineMessages(
  {
    starting: "引擎正在启动",
    held: "先换一家引擎再发",
    send: "发送",
    stopTip: "停止（⌘.）",
    stop: "停止",
    asideTip: "作为侧问发送（⌥⌘↵）——不进正文",
    sendTip: "发送（⌘↵）",
    asideSend: "作为侧问发送",
  },
  {
    starting: "The engine is starting",
    held: "Switch engines before sending",
    send: "Send",
    stopTip: "Stop (⌘.)",
    stop: "Stop",
    asideTip: "Send as a side question (⌥⌘↵), kept out of the main thread",
    sendTip: "Send (⌘↵)",
    asideSend: "Send as side question",
  },
)
