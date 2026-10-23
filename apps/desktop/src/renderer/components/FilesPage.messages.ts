import { defineMessages } from "@switchback/i18n"

/** 侧边面板的「文件」页。 */
export const FILES_PAGE = defineMessages(
  {
    updating: "正在更新搜索结果…",
    searching: "正在搜索…",
    failed: "文件搜索失败，请重试。",
    retry: "重试",
    none: "没有找到文件。",
    results: "搜索结果",
    untouched: "本会话还没有读过或改过文件。",
    quietTurn: "最近一轮没有读写文件。",
    recentEdited: "最近一轮改过",
    recentRead: "最近一轮读过",
    earlier: "此前碰过",
    inherited: "分支继承",
  },
  {
    updating: "Updating search results…",
    searching: "Searching…",
    failed: "File search failed. Try again.",
    retry: "Retry",
    none: "No files found.",
    results: "Search results",
    untouched: "This thread hasn't read or edited any files yet.",
    quietTurn: "The latest turn didn't read or write files.",
    recentEdited: "Edited in the latest turn",
    recentRead: "Read in the latest turn",
    earlier: "Touched earlier",
    inherited: "Inherited from the fork",
  },
)
