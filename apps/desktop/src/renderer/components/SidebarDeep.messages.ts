import { count, defineMessages } from "@switchback/i18n"

/** 侧栏搜索的「正文里提到」那一段。 */
export const SIDEBAR_DEEP = defineMessages(
  {
    hits: (n: number) => `${String(n)} 处`,
    tip: "只搜说过的话，不搜工具调用的命令原文",
    heading: (busy: boolean, n: number) => `正文里提到${busy ? "…" : ` ${String(n)} 条`}`,
    skipped: (n: number) => `历史太多，还有 ${String(n)} 条会话没来得及翻`,
  },
  {
    hits: (n) => count(n, "match", "matches"),
    tip: "Searches what was said, not the commands that tools ran",
    heading: (busy, n) => `Mentioned in messages${busy ? "…" : ` (${String(n)})`}`,
    skipped: (n) => `Too much history: ${count(n, "thread")} not searched yet`,
  },
)
