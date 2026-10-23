import { count, defineMessages } from "@switchback/i18n"

/** 引擎问你的问题卡。 */
export const QUESTION_CARD = defineMessages(
  {
    label: "需要你回答",
    count: (n: number, autoSkip: boolean) => `${String(n)} 题${autoSkip ? " · 将自动跳过" : ""}`,
    skip: "跳过这组",
    answer: "回答",
    stack: "待回答的问题",
  },
  {
    label: "Needs your answer",
    count: (n, autoSkip) => `${count(n, "question")}${autoSkip ? " · skips automatically" : ""}`,
    skip: "Skip these",
    answer: "Answer",
    stack: "Questions waiting for an answer",
  },
)
