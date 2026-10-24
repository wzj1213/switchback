import { defineMessages } from "@switchback/i18n"

/** 历史会话接不回来的几种情况。引擎名原样显示。 */
export const REVIVE = defineMessages(
  {
    gone: (engine: string) => `原来的引擎 ${engine} 已经不在了。在输入框下面换一家引擎，再发一次就能接着做。`,
    lost: (engine: string) =>
      `这条会话没有留下 ${engine} 的会话句柄（可能是旧版本记录），接不回原来的上下文。` +
      "在输入框下面换一家引擎就能接着做。",
    notAttached: "引擎起来之后会话没有接入",
    noHistory: (id: string) => `找不到会话 ${id} 的历史，无法接回引擎`,
  },
  {
    gone: (engine) => `The original engine, ${engine}, is gone. Switch to another engine below the input and send again to keep going.`,
    lost: (engine) =>
      `This thread has no ${engine} session handle left (it may be an older record), so its earlier context can't come back. ` +
      "Switch to another engine below the input to keep going.",
    notAttached: "The thread didn't attach after the engine started",
    noHistory: (id) => `Can't find the history of thread ${id}, so it can't be resumed in an engine`,
  },
)
