import { defineMessages } from "@switchback/i18n"

/** 输入框里 @ 搜工作区文件的那张列表。 */
export const MENTION_LIST = defineMessages(
  {
    files: (cwd: string) => `工作区文件：${cwd}`,
    scope: "搜索范围",
    searching: "正在搜索工作区文件…",
    none: "没有匹配的工作区文件",
    failed: "文件搜索失败",
    retry: "重试",
  },
  {
    files: (cwd) => `Workspace files: ${cwd}`,
    scope: "Searching",
    searching: "Searching workspace files…",
    none: "No matching files in this workspace",
    failed: "File search failed",
    retry: "Retry",
  },
)
