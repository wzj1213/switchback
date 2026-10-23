import { defineMessages } from "@switchback/i18n"

/** 提交栏的表单与结果。失败原因是 git 报的原话，不翻译。 */
export const COMMIT_BAR_VIEW = defineMessages(
  {
    label: "提交",
    reload: "重读",
    less: "收起",
    open: "提交…",
    placeholder: "提交说明：第一行是标题（⌘↩ 提交）",
    message: "提交说明",
    committing: "提交中…",
    undone: "已撤销那次提交，改动回到了暂存区。",
    committed: "已提交 ",
    subject: (subject: string) => `「${subject}」`,
    undoTip: "退回这次提交（git reset --soft），改动留在暂存区",
    undo: "撤销",
    failed: "没成功。",
  },
  {
    label: "Commit",
    reload: "Reload",
    less: "Hide",
    open: "Commit…",
    placeholder: "Commit message: the first line is the subject (⌘↩ to commit)",
    message: "Commit message",
    committing: "Committing…",
    undone: "Commit undone. The changes are back in the staging area.",
    committed: "Committed ",
    subject: (subject) => ` “${subject}”`,
    undoTip: "Undo this commit (git reset --soft); the changes stay staged",
    undo: "Undo",
    failed: "That didn't work.",
  },
)
