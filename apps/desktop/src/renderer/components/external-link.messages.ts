import { defineMessages } from "@switchback/i18n"

/** 回答正文里的外链。 */
export const EXTERNAL_LINK = defineMessages(
  { open: (target: string) => `在浏览器中打开 · ${target}` },
  { open: (target) => `Open in browser · ${target}` },
)
