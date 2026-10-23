import { defineMessages } from "@switchback/i18n"

/** 一个文件是新建、删除还是修改。 */
export const DIFF_KIND = defineMessages(
  { kind: { add: "新建", delete: "删除", update: "修改" } },
  { kind: { add: "Added", delete: "Deleted", update: "Modified" } },
)
