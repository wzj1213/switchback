import { defineMessages } from "@switchback/i18n"

/** 判一条远程调用：设备没了、宿主没挂这条通道。 */
export const REMOTE_CALLER = defineMessages(
  {
    revoked: "这台设备已经被吊销",
    noChannel: (method: string) => `那台机器上没有挂这条通道（${method}）`,
  },
  {
    revoked: "This device has been revoked",
    noChannel: (method) => `The host machine has no channel for this (${method})`,
  },
)
