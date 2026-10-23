import { defineMessages } from "@switchback/i18n"

/** 问题卡里的一题。引擎给了自己的说法（`otherLabel`、`noteLabel`…）就用它的，这些是回落。 */
export const QUESTION_FIELD = defineMessages(
  {
    other: "其他",
    otherAnswer: "其他答案",
    otherPlaceholder: "写下你的答案",
    typeAnswer: "输入回答",
    addContext: "可选：补充上下文",
    answer: "回答",
    note: "补充说明（可选）",
    pickFirst: "先选择一项",
    optional: "可跳过",
    empty: "没有可选项，可以跳过这组问题。",
  },
  {
    other: "Other",
    otherAnswer: "Other answer",
    otherPlaceholder: "Write your answer",
    typeAnswer: "Type your answer",
    addContext: "Optional: add context",
    answer: "Answer",
    note: "Notes (optional)",
    pickFirst: "Pick an option first",
    optional: "Optional",
    empty: "No options to choose from. You can skip these questions.",
  },
)
