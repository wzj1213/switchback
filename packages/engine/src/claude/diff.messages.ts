import { defineMessages } from "@switchback/i18n"

/** `MultiEdit` 合成 diff 里每一处改动的分段头。 */
export const CLAUDE_DIFF = defineMessages(
  { hunk: (n: number) => `@@ 第 ${String(n)} 处 @@` },
  { hunk: (n) => `@@ edit ${String(n)} @@` },
)
