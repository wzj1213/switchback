import { defineMessages } from "@switchback/i18n"

/** 文件清单里的一行。 */
export const FILE_ROW = defineMessages(
  { deleted: "已删除", outside: "工作区外", deletedTip: (path: string) => `${path}\n文件已删除` },
  { deleted: "Deleted", outside: "Outside workspace", deletedTip: (path) => `${path}\nThis file was deleted` },
)
