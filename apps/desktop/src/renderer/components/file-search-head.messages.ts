import { defineMessages } from "@switchback/i18n"

/** 文件页顶上的搜索框。 */
export const FILE_SEARCH_HEAD = defineMessages(
  {
    label: "搜索工作区文件",
    placeholder: "搜索工作区文件…",
    refresh: "立即刷新搜索结果",
    scope: "搜索范围",
    hint: "文件变化会自动更新；最近一轮优先，此前与分支继承分组保留。",
  },
  {
    label: "Search workspace files",
    placeholder: "Search workspace files…",
    refresh: "Refresh search results now",
    scope: "Searching",
    hint: "Updates as files change. The latest turn comes first; earlier and inherited files keep their own groups.",
  },
)
