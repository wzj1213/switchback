import { defineMessages } from "@switchback/i18n"

/** 审核面板：审核范围的名字与说明。 */
export const REVIEW = defineMessages(
  {
    scope: {
      "last-turn": "上一轮",
      uncommitted: "未提交",
      unstaged: "未暂存",
      staged: "已暂存",
      "last-commit": "已提交",
      branch: "分支",
    },
    about: {
      "last-turn": "只看最近一次发送之后留下的改动",
      uncommitted: "当前工作区相对 HEAD 的全部改动",
      unstaged: "尚未加入暂存区的改动与新文件",
      staged: "已经加入 Git 暂存区的改动",
      "last-commit": "最近一次提交带来的改动",
      branch: "当前分支相对上游或主分支的改动",
    },
    fallback: "审核范围",
    label: "审核改动",
    pick: "选择审核范围",
  },
  {
    scope: {
      "last-turn": "Last turn",
      uncommitted: "Uncommitted",
      unstaged: "Unstaged",
      staged: "Staged",
      "last-commit": "Last commit",
      branch: "Branch",
    },
    about: {
      "last-turn": "Only the changes left since your last message",
      uncommitted: "All changes in the workspace against HEAD",
      unstaged: "Changes and new files not staged yet",
      staged: "Changes already in the Git staging area",
      "last-commit": "Changes from the most recent commit",
      branch: "Changes on this branch against its upstream or the main branch",
    },
    fallback: "Review range",
    label: "Review changes",
    pick: "Choose what to review",
  },
)
