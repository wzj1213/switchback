import { defineMessages } from "@switchback/i18n"

/** ACP 会话自己说的几句：进程退了、换档要重启、没回收干净、设置页的探测提示。 */
export const ACP_DRIVER = defineMessages(
  {
    exited: (id: string, how: string) => `${id} 进程已退出（${how}）`,
    bySignal: (signal: string) => `信号 ${signal}`,
    nativeRestart: (id: string) => `${id} 的原生审批档要在开场设置；请等当前轮结束后续接重启。`,
    closing: "会话正在关闭",
    leaked: (id: string, pid: string) => `${id} 进程组未能回收（pid ${pid}），可能已泄漏`,
    probeHint: "检查 engines.json 里写的路径对不对；改完点 设置 → 安装与接入 里的「重新探测」。",
  },
  {
    exited: (id, how) => `The ${id} process exited (${how})`,
    bySignal: (signal) => `signal ${signal}`,
    nativeRestart: (id) => `${id}'s native approval mode is set when the thread opens. Wait for the current turn to end; Switchback then resumes and restarts it.`,
    closing: "The thread is closing",
    leaked: (id, pid) => `The ${id} process group couldn't be reclaimed (pid ${pid}) and may have leaked`,
    probeHint: "Check that the path in engines.json is right; after editing it, click “Detect again” in Settings → Install & connect.",
  },
)
