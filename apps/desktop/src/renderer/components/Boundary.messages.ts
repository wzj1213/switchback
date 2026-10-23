import { defineMessages } from "@switchback/i18n"

/** 渲染层崩溃时的兜底页。 */
export const BOUNDARY = defineMessages(
  {
    title: "界面崩了",
    hint: "引擎进程还活着，会话记录也已经落盘——重载窗口就能回到刚才的状态。",
    reload: "重载窗口",
  },
  {
    title: "The interface crashed",
    hint: "The engine processes are still running and the thread history is saved. Reload the window to get back to where you were.",
    reload: "Reload window",
  },
)
