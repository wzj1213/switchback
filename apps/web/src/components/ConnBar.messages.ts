import { defineMessages } from "@switchback/i18n"

/** 顶上那条连接状态。断开的原因是连接层报的，原样显示。 */
export const CONN_BAR = defineMessages(
  {
    connecting: "正在连接…",
    retryIn: (seconds: number) => `${String(seconds)} 秒后重试`,
    retryNow: "立刻重试",
    closed: "连接已关闭",
  },
  {
    connecting: "Connecting…",
    retryIn: (seconds) => `retrying in ${String(seconds)}s`,
    retryNow: "Retry now",
    closed: "Connection closed",
  },
)
