import { defineMessages } from "@switchback/i18n"

/** 排着的那句发不出去时的横幅。理由是引擎或宿主报的原话。 */
export const HOST = defineMessages(
  { queuedFailed: (why: string) => `排队的那句没发出去：${why}` },
  { queuedFailed: (why) => `The queued message wasn't sent: ${why}` },
)
