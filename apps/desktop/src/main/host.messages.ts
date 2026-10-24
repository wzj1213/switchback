import { defineMessages } from "@switchback/i18n"

/** 宿主自己弹的框、自己写进转录区的话。 */
export const HOST = defineMessages(
  {
    pickFolder: "选择工作区",
    journalFull:
      "这个会话的本地记录写满了（单个会话上限 32 MB），**之后说的话不会再落盘**。" +
      "对话本身照常进行，但重启之后看不到接下来这些。要留存的话，新开一个会话继续。",
  },
  {
    pickFolder: "Choose a Workspace",
    journalFull:
      "This thread's local record is full (32 MB per thread), so **nothing said from now on will be saved**. " +
      "The conversation itself goes on, but after a restart you won't see what comes next. To keep it, continue in a new thread.",
  },
)
