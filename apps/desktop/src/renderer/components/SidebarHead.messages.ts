import { defineMessages } from "@switchback/i18n"

/** 侧栏顶部：新建会话与打开文件夹。 */
export const SIDEBAR_HEAD = defineMessages(
  {
    pickFolder: "选文件夹…",
    chat: "对话",
    newTip: (where: string) => `新建会话 —— 落在 ${where}`,
    newThread: "新建会话",
    openFolder: "打开文件夹…",
  },
  {
    pickFolder: "a folder you pick",
    chat: "Chats",
    newTip: (where) => `New thread in ${where}`,
    newThread: "New thread",
    openFolder: "Open folder…",
  },
)
