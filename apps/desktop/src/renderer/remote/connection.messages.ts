import { defineMessages } from "@switchback/i18n"

/** 远程连接断掉时，还在等的那些调用得到的原因。 */
export const REMOTE_CONNECTION = defineMessages(
  {
    revoked: "这台设备的令牌不认了（被吊销、或者换了机器），要重新配对",
    reconnecting: "正在重连",
    closed: "页面关了",
  },
  {
    revoked: "This device's token is no longer accepted (revoked, or the host machine changed). Pair again.",
    reconnecting: "reconnecting",
    closed: "the page was closed",
  },
)
