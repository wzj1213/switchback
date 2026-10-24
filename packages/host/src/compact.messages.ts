import { defineMessages } from "@switchback/i18n"

/** 压缩上下文要等这一轮停下来。 */
export const COMPACT = defineMessages(
  { busy: "这一轮还在跑，压缩要等它停下来" },
  { busy: "This turn is still running; compacting has to wait until it stops" },
)
