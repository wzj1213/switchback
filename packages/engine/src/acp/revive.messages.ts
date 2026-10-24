import { defineMessages } from "@switchback/i18n"

/** 睡着的会话挂不回来的两种情况。 */
export const ACP_REVIVE = defineMessages(
  {
    noHandle: (id: string) => `${id} 还没有会话句柄，挂不回来`,
    noLoad: (id: string) => `${id} 没有声明 loadSession，这条会话挂不回来`,
  },
  {
    noHandle: (id) => `${id} has no session handle yet, so it can't be reattached`,
    noLoad: (id) => `${id} doesn't declare loadSession, so this thread can't be reattached`,
  },
)
