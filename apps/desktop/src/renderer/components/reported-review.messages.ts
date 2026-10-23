import { count, defineMessages } from "@switchback/i18n"

/** 「本轮改动」：引擎上报的编辑，不是 Git 差异。 */
export const REPORTED_REVIEW = defineMessages(
  {
    label: "审核改动",
    title: "本轮改动",
    files: (n: number) => `${String(n)} 个文件`,
    unified: "单栏",
    split: "并排",
    hideFiles: "隐藏文件",
    showFiles: "显示文件",
    git: "Git 差异",
    noMatch: "没有匹配的文件",
  },
  {
    label: "Review changes",
    title: "This turn's changes",
    files: (n) => count(n, "file"),
    unified: "Unified",
    split: "Split",
    hideFiles: "Hide files",
    showFiles: "Show files",
    git: "Git diff",
    noMatch: "No matching files",
  },
)
