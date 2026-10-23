import { defineMessages } from "@switchback/i18n"

/** 右键菜单。 */
export const MENU_TEXT = defineMessages(
  { label: "操作", clear: (what: string) => `清除${what}`, noIcon: "不要图标" },
  { label: "Actions", clear: (what) => `Clear ${what.toLowerCase()}`, noIcon: "No icon" },
)
