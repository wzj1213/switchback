import { defineMessages } from "@switchback/i18n"

/** 连接条上「为什么断了」那一句。服务端给的关闭原因原样显示。 */
export const TRANSPORT = defineMessages(
  {
    closed: "连接断开",
    unreachable: "连不上 Switchback",
    badFrame: (detail: string) => `收到一帧坏数据（${detail}），重新连接`,
  },
  {
    closed: "Connection lost",
    unreachable: "Can't reach Switchback",
    badFrame: (detail) => `Received a bad frame (${detail}); reconnecting`,
  },
)
