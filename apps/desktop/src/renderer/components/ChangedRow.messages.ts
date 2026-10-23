import { defineMessages } from "@switchback/i18n"

/** 改动卡里的一个文件。 */
export const CHANGED_ROW = defineMessages(
  {
    reveal: "在访达中显示",
    preview: "预览文件",
    previewTip: "在工作台预览",
    noPatch: "引擎未提供补丁内容",
    copy: "复制这次编辑记录",
    copied: "编辑记录已复制",
    open: (path: string) => `查看本轮编辑记录\n${path}`,
    outside: "工作区外",
  },
  {
    reveal: "Show in Finder",
    preview: "Preview file",
    previewTip: "Preview in workbench",
    noPatch: "The engine didn't provide the patch",
    copy: "Copy this edit",
    copied: "Edit copied",
    open: (path) => `View this turn's edit\n${path}`,
    outside: "Outside workspace",
  },
)
