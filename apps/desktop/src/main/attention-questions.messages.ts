import { defineMessages } from "@switchback/i18n"

/** 后台问题、主轮之外的权限请求在系统通知里的那句话。问题和摘要是引擎报的，不翻译。 */
export const ATTENTION_QUESTIONS = defineMessages(
  {
    question: (what: string) => `等你回答：${what}`,
    needsAnswer: "引擎需要你的回答",
    background: (summary: string) => `后台在等你确认：${summary}`,
    subagent: (summary: string) => `子 agent 在等你确认：${summary}`,
  },
  {
    question: (what) => `Needs your answer: ${what}`,
    needsAnswer: "The engine needs your answer",
    background: (summary) => `Background work needs your approval: ${summary}`,
    subagent: (summary) => `A subagent needs your approval: ${summary}`,
  },
)
