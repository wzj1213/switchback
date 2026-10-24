import { defineMessages } from "@switchback/i18n"

/** codex 会话自己说的几句：进程退了、改不了向、换档要重启、没回收干净。 */
export const CODEX_DRIVER = defineMessages(
  {
    exited: (how: string) => `codex 进程已退出（${how}）`,
    bySignal: (signal: string) => `信号 ${signal}`,
    noTurn: "没有正在跑的轮次，改不了向",
    trustRestart: "Codex 的原生沙箱在会话开场时固定。请等当前轮结束；Switchback 会续接同一条会话后重启，让新档位真正生效。",
    closing: "会话正在关闭",
    leaked: (pid: string) => `codex 进程组未能回收（pid ${pid}），可能已泄漏`,
  },
  {
    exited: (how) => `The codex process exited (${how})`,
    bySignal: (signal) => `signal ${signal}`,
    noTurn: "No turn is running, so it can't be steered",
    trustRestart: "Codex's native sandbox is fixed when the thread opens. Wait for the current turn to end; Switchback then resumes the same thread and restarts it so the new tier takes effect.",
    closing: "The thread is closing",
    leaked: (pid) => `The codex process group couldn't be reclaimed (pid ${pid}) and may have leaked`,
  },
)
