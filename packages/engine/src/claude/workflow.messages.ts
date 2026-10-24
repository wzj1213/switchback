import { defineMessages } from "@switchback/i18n"

/** 工作流没报阶段名时那一层叫什么。 */
export const CLAUDE_WORKFLOW = defineMessages(
  { phase: (n: number) => `阶段 ${String(n)}` },
  { phase: (n) => `Phase ${String(n)}` },
)
