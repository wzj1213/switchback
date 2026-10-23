import { count, defineMessages } from "@switchback/i18n"

/** 侧栏行与项目的右键菜单。 */
export const SIDEBAR_MENUS = defineMessages(
  {
    moveUp: "上移",
    moveDown: "下移",
    newHere: "在此新建会话",
    unpin: "取消置顶",
    pinProject: "置顶项目",
    reveal: "在访达中显示",
    copyPath: "复制路径",
    threads: (n: number) => `${String(n)} 个会话`,
    running: (n: number) => ` · ${String(n)} 个在跑`,
    pinThread: "置顶这个会话",
    rename: "重命名",
    remove: "删除会话…",
    dropProject: "移出侧栏",
    icon: "图标",
  },
  {
    moveUp: "Move up",
    moveDown: "Move down",
    newHere: "New thread here",
    unpin: "Unpin",
    pinProject: "Pin project",
    reveal: "Show in Finder",
    copyPath: "Copy path",
    threads: (n) => count(n, "thread"),
    running: (n) => ` · ${String(n)} running`,
    pinThread: "Pin thread",
    rename: "Rename",
    remove: "Delete thread…",
    dropProject: "Remove from sidebar",
    icon: "Icon",
  },
)
