import { defineMessages } from "@switchback/i18n"

/** 还没有会话、或者界面和后台没接上时的主区。 */
export const SCREENS = defineMessages(
  {
    bridgeMissing: "与主进程的通道没建立（preload 未注入）。界面此时点什么都不会有反应——先查主进程日志。",
    failed: "没有可用的会话。上方的故障说明了原因；处理好之后点「＋ 新建会话」重试。",
    none: "还没有会话",
    opening: "正在打开工作区…",
    region: "应用状态",
    disconnected: "界面和后台没接上",
  },
  {
    bridgeMissing:
      "The channel to the main process isn't up (the preload script wasn't injected). Nothing you click will respond. Check the main process log first.",
    failed: "No thread is available. The notice above says why; once that's fixed, click “+ New thread” to try again.",
    none: "No threads yet",
    opening: "Opening the workspace…",
    region: "App status",
    disconnected: "The interface isn't connected to the background process",
  },
)
