import { defineMessages } from "@switchback/i18n"

/** 轮次收工时还没报结果的 hook。 */
export const CODEX_HOOKS = defineMessages(
  { noResult: "Codex 在轮次结束前没有报告这次 hook 的结果。" },
  { noResult: "Codex didn't report the result of this hook before the turn ended." },
)
