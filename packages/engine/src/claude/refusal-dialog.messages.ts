import { defineMessages } from "@switchback/i18n"

/** 原模型拒了这次请求时问你的那张卡。模型名原样显示。 */
export const CLAUDE_REFUSAL = defineMessages(
  {
    header: "Claude · 会话已暂停",
    question: "这次请求被原模型拒绝，接下来怎么做？",
    retry: (fallback: string) => `切换到 ${fallback}`,
    retryHint: "用备用模型重试当前请求",
    edit: (original: string) => `修改后继续用 ${original}`,
    editHint: "结束当前轮；在输入框修改后重新发送",
  },
  {
    header: "Claude · Thread paused",
    question: "The original model refused this request. What next?",
    retry: (fallback) => `Switch to ${fallback}`,
    retryHint: "Retry the current request with the fallback model",
    edit: (original) => `Edit and keep using ${original}`,
    editHint: "End the current turn; edit in the input and send again",
  },
)
