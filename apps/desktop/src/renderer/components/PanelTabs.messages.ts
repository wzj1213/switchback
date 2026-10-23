import { defineMessages } from "@switchback/i18n"

/** 侧边面板顶上的页签。 */
export const PANEL_TABS = defineMessages(
  {
    label: { review: "审查", files: "文件", activity: "活动" },
    about: {
      review: "查看工作区的真实 Git 差异",
      files: "搜索并预览当前工作区文件",
      activity: "查看引擎公开的后台任务与输出",
    },
    pages: "侧边面板页面",
    sideBySide: "并排显示侧边面板",
    expand: "展开侧边面板",
    hide: "收起侧边面板",
  },
  {
    label: { review: "Review", files: "Files", activity: "Activity" },
    about: {
      review: "See the workspace's actual Git diff",
      files: "Search and preview files in this workspace",
      activity: "See background tasks and output the engine reports",
    },
    pages: "Side panel pages",
    sideBySide: "Show side panel next to the thread",
    expand: "Expand side panel",
    hide: "Hide side panel",
  },
)
