import { defineMessages } from "@switchback/i18n"

/** 宿主好几处都会说的报错。会经 `engine.status` 出现在横幅上，所以跟着界面语言。 */
export const CTX = defineMessages(
  {
    closed: "宿主已经关闭",
    removed: (id: string) => `会话已经删除：${id}`,
    noThread: (id: string) => `会话不存在：${id}`,
    noEngine: (id: string) => `未注册的引擎：${id}`,
  },
  {
    closed: "The host has shut down",
    removed: (id) => `This thread was deleted: ${id}`,
    noThread: (id) => `No such thread: ${id}`,
    noEngine: (id) => `Engine not registered: ${id}`,
  },
)
