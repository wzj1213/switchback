import { defineMessages } from "@switchback/i18n"

/** 侧栏搜索：按标题、首句、目录匹配到的会话。 */
export const SIDEBAR_HITS = defineMessages(
  {
    heading: (n: number, total: number) => `会话信息 ${String(n)} / ${String(total)}`,
    results: "搜索结果",
    none: "标题、首句和目录没有匹配。",
  },
  {
    heading: (n, total) => `Matching threads ${String(n)} / ${String(total)}`,
    results: "search results",
    none: "No matches in titles, first messages, or folders.",
  },
)
