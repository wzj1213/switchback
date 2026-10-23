import { defineMessages } from "@switchback/i18n"

/** 审核面板里「跳转到文件」那个搜索框。 */
export const REVIEW_FILE_JUMP = defineMessages(
  { jump: "跳转到文件", placeholder: "跳转到文件…", results: "匹配的审核文件", none: "没有匹配的改动文件" },
  { jump: "Go to file", placeholder: "Go to file…", results: "Matching changed files", none: "No matching changed files" },
)
