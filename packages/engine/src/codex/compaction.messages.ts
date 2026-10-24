import { defineMessages } from "@switchback/i18n"

/** 压缩上下文开不了头的两种情况。 */
export const CODEX_COMPACTION = defineMessages(
  { notReady: "会话还没起来，没法压缩", busy: "Codex 还有一轮正在运行，没法压缩" },
  { notReady: "The thread hasn't started yet, so it can't be compacted", busy: "Codex still has a turn running, so it can't compact" },
)
