import { defineMessages } from "@switchback/i18n"

/** 上下文压缩在转录区那一条。token 数原样显示。 */
export const CLAUDE_COMPACTION = defineMessages(
  {
    compacted: (auto: boolean, before: number | undefined, after: number | undefined) => {
      const label = auto ? "上下文已自动压缩" : "上下文已压缩"
      return before === undefined || after === undefined ? `${label}。` : `${label}：${String(before)} → ${String(after)} tokens。`
    },
    failed: (detail: string) => (detail === "" ? "上下文压缩未完成。" : `上下文压缩未完成：${detail}`),
    compacting: "正在压缩上下文…",
    done: "上下文已压缩。",
  },
  {
    compacted: (auto, before, after) => {
      const label = auto ? "Context compacted automatically" : "Context compacted"
      return before === undefined || after === undefined ? `${label}.` : `${label}: ${String(before)} → ${String(after)} tokens.`
    },
    failed: (detail) => (detail === "" ? "Context compaction didn't finish." : `Context compaction didn't finish: ${detail}`),
    compacting: "Compacting context…",
    done: "Context compacted.",
  },
)
