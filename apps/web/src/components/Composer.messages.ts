import { defineMessages } from "@switchback/i18n"

/** 手机上的输入框。 */
export const COMPOSER = defineMessages(
  {
    locked: "这条会话现在不能发消息",
    placeholder: "说点什么…",
    stop: "停下",
    send: "发送",
  },
  {
    locked: "You can't send in this thread right now",
    placeholder: "Say something…",
    stop: "Stop",
    send: "Send",
  },
)
