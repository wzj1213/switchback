import { defineMessages } from "@switchback/i18n"

/** Claude 会话自己说的话：进程退了、输入流关了、改不了向、换档要重启、没回收干净。 */
export const CLAUDE_DRIVER = defineMessages(
  {
    exited: "Claude Code 进程已退出",
    exitedWith: (why: string) => `Claude Code 进程已退出：${why}`,
    inputClosed: "Claude 输入流已经关闭，这句话没有送达。请重新连接会话后再试。",
    inputClosedShort: "Claude 输入流已经关闭",
    noTurn: "Claude 当前没有可插入的轮次",
    turnEnded: "Claude 原轮次已经结束",
    effortFailed: (why: string) => `Claude 设推理强度失败：${why}`,
    bypass: "Claude 的完全访问需要在会话启动时显式允许 Bypass。请等当前轮结束；Switchback 会续接同一条会话后重启。",
    notReady: "Claude 会话尚未就绪，无法切换权限档",
    leaked: (pid: string) => `引擎进程组未能回收（pid ${pid}），可能已泄漏`,
  },
  {
    exited: "The Claude Code process exited",
    exitedWith: (why) => `The Claude Code process exited: ${why}`,
    inputClosed: "Claude's input stream is closed, so this message wasn't delivered. Reconnect the thread and try again.",
    inputClosedShort: "Claude's input stream is closed",
    noTurn: "Claude has no turn to insert into right now",
    turnEnded: "Claude's original turn has already ended",
    effortFailed: (why) => `Couldn't set Claude's reasoning effort: ${why}`,
    bypass: "Claude's full access has to be allowed as Bypass when the thread starts. Wait for the current turn to end; Switchback then resumes the same thread and restarts it.",
    notReady: "The Claude thread isn't ready yet, so the trust tier can't be switched",
    leaked: (pid) => `The engine's process group couldn't be reclaimed (pid ${pid}) and may have leaked`,
  },
)
