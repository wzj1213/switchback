import { defineMessages } from "@switchback/i18n"

/** 审核面板里一个文件的改动种类。 */
export const REVIEW_KIND = defineMessages(
  { kind: { add: "新建", delete: "删除", update: "修改", rename: "改名", untracked: "未跟踪" } },
  { kind: { add: "Added", delete: "Deleted", update: "Modified", rename: "Renamed", untracked: "Untracked" } },
)
