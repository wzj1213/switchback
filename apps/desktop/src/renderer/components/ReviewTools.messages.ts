import { defineMessages } from "@switchback/i18n"

/** 审核面板右上那排工具键。 */
export const REVIEW_TOOLS = defineMessages(
  {
    label: "差异查看工具",
    collapse: "收起全部差异",
    expand: "展开全部差异",
    narrow: "补丁区放不下两列代码：收起文件清单或展开面板",
    unified: "切换到统一差异",
    split: "切换到分栏差异",
    hideFiles: "隐藏文件",
    showFiles: "显示文件",
    reload: "刷新 Git 差异",
  },
  {
    label: "Diff view tools",
    collapse: "Collapse to changed lines",
    expand: "Show full files",
    narrow: "Not enough room for two columns. Hide the file list or widen the panel.",
    unified: "Switch to unified diff",
    split: "Switch to split diff",
    hideFiles: "Hide files",
    showFiles: "Show files",
    reload: "Refresh Git diff",
  },
)
