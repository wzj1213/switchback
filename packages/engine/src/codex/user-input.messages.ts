import { defineMessages } from "@switchback/i18n"

/** codex 结构化问题的回落说法；问题与选项是引擎写的，不翻译。 */
export const CODEX_USER_INPUT = defineMessages(
  {
    answer: "回答",
    note: "补充说明（可选）",
    typeAnswer: "输入回答",
    addContext: "可选：补充上下文",
    none: "以上都不是",
    writeAnswer: "写下你的答案",
  },
  {
    answer: "Answer",
    note: "Notes (optional)",
    typeAnswer: "Type your answer",
    addContext: "Optional: add context",
    none: "None of the above",
    writeAnswer: "Write your answer",
  },
)
