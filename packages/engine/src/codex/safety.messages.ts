import { defineMessages } from "@switchback/i18n"

/** codex 的安全检查、模型改道在转录区留的那句话。模型名原样显示。 */
export const CODEX_SAFETY = defineMessages(
  {
    cyber: "这段会话多次触发了可能的网络安全风险标记，因此 Codex 已启用额外安全检查，响应可能更慢。如需进行经授权的安全工作，可申请 Trusted Access for Cyber：https://chatgpt.com/cyber",
    rerouted: (from: string, to: string, cyber: boolean) => `Codex 已将模型从 ${from} 改为 ${to}${cyber ? "（触发网络安全风险检查）" : ""}。`,
    strict: "这个请求需要额外安全检查，部分工具调用可能会花更久。",
    buffering: (faster: string | undefined) =>
      `Codex 正在对这个请求做额外安全检查，响应可能需要更久；无需操作，它会继续等待。${faster === undefined ? "" : ` Codex 也提供更快模型「${faster}」供重试；如需改用，请先停止当前轮。`}`,
    resumed: "Codex 已结束额外安全检查，正在继续响应。",
    finished: "Codex 已结束额外安全检查。",
    endedWith: (interrupted: boolean) => `Codex 的额外安全检查已随本轮${interrupted ? "中断" : "失败"}结束。`,
  },
  {
    cyber: "This thread repeatedly triggered possible cybersecurity risk flags, so Codex turned on extra safety checks and responses may be slower. For authorized security work, you can apply for Trusted Access for Cyber: https://chatgpt.com/cyber",
    rerouted: (from, to, cyber) => `Codex switched the model from ${from} to ${to}${cyber ? " (a cybersecurity risk check was triggered)" : ""}.`,
    strict: "This request needs extra safety checks, so some tool calls may take longer.",
    buffering: (faster) =>
      `Codex is running extra safety checks on this request, so the response may take longer. No action needed; it keeps waiting.${faster === undefined ? "" : ` Codex also offers a faster model, “${faster}”, for retrying; to use it, stop the current turn first.`}`,
    resumed: "Codex finished the extra safety checks and is continuing the response.",
    finished: "Codex finished the extra safety checks.",
    endedWith: (interrupted) => `Codex's extra safety checks ended because the turn ${interrupted ? "was interrupted" : "failed"}.`,
  },
)
