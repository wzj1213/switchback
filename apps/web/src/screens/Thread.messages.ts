import { count, defineMessages } from "@switchback/i18n"

/** 一条会话的正文页。 */
export const THREAD = defineMessages(
  {
    context: (used: number, total: number) => `上下文 ${String(used)} / ${String(total)}`,
    running: "正在跑…",
    thinking: (tokens: number) => `正在思考 · 约 ${String(tokens)} tokens`,
    empty: "这条会话还没有内容。",
    loading: "正在取这条会话的内容…",
    earlier: (n: number) => `显示更早的 ${String(n)} 条`,
    trimmed: "更早的内容没有加载。完整记录在桌面上。",
    back: "返回列表",
    toBottom: "回到底部",
  },
  {
    context: (used, total) => `Context ${String(used)} / ${String(total)}`,
    running: "Running…",
    thinking: (tokens) => `Thinking · about ${String(tokens)} tokens`,
    empty: "This thread has no messages yet.",
    loading: "Loading this thread…",
    earlier: (n) => `Show ${count(n, "earlier item")}`,
    trimmed: "Earlier messages aren't loaded. The full history is on the desktop.",
    back: "Back to list",
    toBottom: "Jump to bottom",
  },
)
