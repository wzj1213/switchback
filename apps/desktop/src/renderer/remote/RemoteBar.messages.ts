import { defineMessages } from "@switchback/i18n"

/** 远程窗口顶上那条连接状态。 */
export const REMOTE_BAR = defineMessages(
  {
    connecting: "正在连那台机器…",
    retrying: (reason: string, seconds: number) => `断了（${reason}），${String(seconds)} 秒后重连`,
    unauthorized: "这台电脑的授权不在了（被吊销，或者那台换了机器）",
    closed: "连接已关闭",
    repair: "重新配对",
    ok: "知道了",
  },
  {
    connecting: "Connecting to the host machine…",
    retrying: (reason, seconds) => `Disconnected (${reason}); reconnecting in ${String(seconds)}s`,
    unauthorized: "This computer's authorization is gone (revoked, or the host machine changed)",
    closed: "Connection closed",
    repair: "Pair again",
    ok: "Got it",
  },
)
