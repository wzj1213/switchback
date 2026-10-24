import { defineMessages } from "@switchback/i18n"

/** 上下文压缩在转录区那一条。条数与 token 数原样显示。 */
export const KIMI_COMPACTION = defineMessages(
  {
    done: "上下文已压缩。",
    counted: (count: number, before: number, after: number) =>
      `上下文已压缩：${String(count)} 条消息，${String(before)} → ${String(after)} tokens。`,
    compacting: "正在压缩上下文…",
    cancelled: "上下文压缩已取消。",
    afterGap: "压缩期间连接断过，没收到 Kimi 报的结果；它现在已经空闲，上下文用量以它报的为准。",
  },
  {
    done: "Context compacted.",
    counted: (count, before, after) =>
      `Context compacted: ${String(count)} ${count === 1 ? "message" : "messages"}, ${String(before)} → ${String(after)} tokens.`,
    compacting: "Compacting context…",
    cancelled: "Context compaction was cancelled.",
    afterGap: "The connection dropped during compaction, so Kimi's result never arrived. It's idle now; trust the context usage it reports.",
  },
)
