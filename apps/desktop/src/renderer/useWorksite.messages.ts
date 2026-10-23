import { defineMessages } from "@switchback/i18n"

/** 分支芯片上的游离标记。 */
export const WORKSITE = defineMessages(
  { detached: (head: string) => `游离 · ${head}` },
  { detached: (head) => `detached · ${head}` },
)
