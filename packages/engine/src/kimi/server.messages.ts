import { defineMessages } from "@switchback/i18n"

/** 共用的那个 `kimi web` 进程起不来、退了、收不回时说的话。退出码与 stderr 原样附上。 */
export const KIMI_SERVER = defineMessages(
  {
    noAddress: "Kimi Web 服务没有报告地址",
    notReady: (seconds: number) => `Kimi Web 服务在 ${String(seconds)} 秒内没有就绪`,
    noWebSocket: "这个 Kimi 版本没有公开 WebSocket 能力，请升级 Kimi Code",
    noAuth: "Kimi Web 服务关闭了鉴权；Switchback 拒绝连接这个不安全的实例",
    exited: (code: string) => `Kimi Web 服务已退出（code ${code}）`,
    leaked: (pid: string) => `Kimi Web 进程组未能回收（pid ${pid}），可能已泄漏`,
  },
  {
    noAddress: "The Kimi Web server didn't report its address",
    notReady: (seconds) => `The Kimi Web server wasn't ready within ${String(seconds)} seconds`,
    noWebSocket: "This Kimi version doesn't offer WebSocket. Upgrade Kimi Code",
    noAuth: "The Kimi Web server has authentication turned off; Switchback won't connect to an unprotected instance",
    exited: (code) => `The Kimi Web server exited (code ${code})`,
    leaked: (pid) => `The Kimi Web process group couldn't be reclaimed (pid ${pid}) and may have leaked`,
  },
)
