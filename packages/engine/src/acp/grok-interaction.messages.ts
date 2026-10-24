import { defineMessages } from "@switchback/i18n"

/** Grok 问你的问题与计划审批卡。问题、选项、计划正文是 Grok 写的，不翻译。 */
export const GROK_INTERACTION = defineMessages(
  {
    other: "其他",
    writeAnswer: "写下你的答案",
    note: "补充说明（可选）",
    addContext: "可选：补充上下文",
    planHeader: "Grok 计划审批",
    planQuestion: "如何处理这份计划？",
    noPlan: "Grok 未提供计划正文。",
    approve: "批准并执行",
    approveHint: "退出计划模式并开始执行",
    revise: "要求修改",
    reviseHint: "把补充说明反馈给 Grok，继续规划",
    abandon: "放弃计划",
    abandonHint: "退出计划模式但不执行",
    planNote: "修改意见（可选）",
    planNoteHint: "选择“要求修改”时，可在这里说明要改什么",
  },
  {
    other: "Other",
    writeAnswer: "Write your answer",
    note: "Notes (optional)",
    addContext: "Optional: add context",
    planHeader: "Grok plan review",
    planQuestion: "What should happen with this plan?",
    noPlan: "Grok didn't include the plan text.",
    approve: "Approve and run",
    approveHint: "Leave plan mode and start working",
    revise: "Ask for changes",
    reviseHint: "Send your notes back to Grok and keep planning",
    abandon: "Drop the plan",
    abandonHint: "Leave plan mode without running it",
    planNote: "Requested changes (optional)",
    planNoteHint: "If you choose “Ask for changes”, say what to change here",
  },
)
