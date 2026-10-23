import { defineMessages } from "@switchback/i18n"

/** 侧栏「项目」那一段。 */
export const SIDEBAR_PROJECTS = defineMessages(
  {
    title: "项目",
    openFolder: "打开一个文件夹",
    dropToUnpin: "松手取消置顶",
    less: "收起",
    more: (n: number) => `展开显示（还有 ${String(n)} 个）`,
  },
  {
    title: "Projects",
    openFolder: "Open a folder",
    dropToUnpin: "Drop to unpin",
    less: "Show less",
    more: (n) => `Show ${String(n)} more`,
  },
)
