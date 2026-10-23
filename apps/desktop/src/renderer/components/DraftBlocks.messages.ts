import { defineMessages } from "@switchback/i18n"

/** 输入框里的文件与粘贴块。 */
export const DRAFT_BLOCKS = defineMessages(
  { remove: (what: string) => `移除 ${what}`, pasted: "这段粘贴文本" },
  { remove: (what) => `Remove ${what}`, pasted: "this pasted text" },
)
