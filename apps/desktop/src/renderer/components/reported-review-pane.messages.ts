import { defineMessages } from "@switchback/i18n"

/** 「本轮改动」里一个文件的编辑记录。 */
export const REPORTED_REVIEW_PANE = defineMessages(
  {
    record: "本轮编辑记录",
    pick: "选择本轮编辑记录",
    nthBefore: "第 ",
    nthAfter: (n: number) => ` / ${String(n)} 次`,
    reported: "引擎上报",
    preview: "预览当前文件",
    git: "查看 Git 差异",
  },
  {
    record: "Edits this turn",
    pick: "Choose an edit from this turn",
    nthBefore: "Edit ",
    nthAfter: (n) => ` of ${String(n)}`,
    reported: "Reported by the engine",
    preview: "Preview current file",
    git: "View Git diff",
  },
)
