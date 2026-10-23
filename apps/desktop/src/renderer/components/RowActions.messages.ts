import { defineMessages } from "@switchback/i18n"

/** 会话行悬停时的「更多」与删除确认。 */
export const ROW_ACTIONS = defineMessages(
  { confirmLabel: "确认删除", confirmTip: "再点一次就真的删了，不可撤销", confirm: "确认", more: "更多操作" },
  { confirmLabel: "Confirm delete", confirmTip: "Click again to delete. This can't be undone.", confirm: "Delete", more: "More actions" },
)
