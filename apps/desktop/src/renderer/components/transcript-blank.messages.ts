import { defineMessages } from "@switchback/i18n"

/** 一条会话还没有内容时那一屏。 */
export const TRANSCRIPT_BLANK = defineMessages(
  {
    fetching: "正在取这条会话的内容…",
    fetchingNote: "它在那台机器上，打开时才传过来。",
    resume: "继续这段工作",
    startBefore: "开始在 ",
    startAfter: " 中工作",
    connecting: "正在连接引擎…",
    describe: "描述你要完成的工作，或拖入相关文件。",
    adoptedBefore: "这条是从引擎那边接过来的。",
    adoptedStrong: "前面聊过什么它都记得",
    adoptedAfter: "，只是这次没有拿到可展示的历史正文；接着聊不会丢掉引擎里的上下文。",
  },
  {
    fetching: "Loading this thread…",
    fetchingNote: "It lives on the other Mac and comes over when you open it.",
    resume: "Pick up where this left off",
    startBefore: "Start working in ",
    startAfter: "",
    connecting: "Connecting to the engine…",
    describe: "Describe what you want done, or drop in related files.",
    adoptedBefore: "This thread came over from the engine. ",
    adoptedStrong: "It remembers everything you discussed",
    adoptedAfter: ", but no history came back that can be shown here. Keep going and the engine's context stays intact.",
  },
)
