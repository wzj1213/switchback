import { defineMessages } from "@switchback/i18n"

/** 远程窗口调宿主通道没成时回的理由。通道自己抛的错原样回。 */
export const REMOTE_CALLS = defineMessages(
  {
    failed: "宿主执行这一条时出错了",
    noMethod: "调用没写要调哪条通道",
    unsupported: "这条连接不支持调用宿主通道",
    tooMany: (max: number) => `同时在途的调用超过 ${String(max)} 条，这一条没有执行`,
  },
  {
    failed: "The host hit an error running this",
    noMethod: "The call didn't say which channel to use",
    unsupported: "This connection can't call host channels",
    tooMany: (max) => `More than ${String(max)} calls are in flight, so this one wasn't run`,
  },
)
