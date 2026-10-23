import { defineMessages } from "@switchback/i18n"

/** 设置 → 远程访问：服务开关与端口。报错原文来自主进程。 */
export const REMOTE_PANEL = defineMessages(
  {
    listeningError: (error: string) => `在听，但配置有问题：${error}`,
    cantStart: (error: string) => `起不来：${error}`,
    off: "关着。打开之后它只听回环，不会凭空暴露到网上",
    listening: (port: number) => `在听 127.0.0.1:${String(port)}`,
    notListening: "开着，但没在听",
    port: "端口",
    portBad: "要一个 0–65535 的整数。改完这一栏服务端会重起一次，正连着的设备要刷新一下。",
    portHint: "回环上的端口。0 = 让系统挑一个空的。改完服务端会重起一次，隧道命令里的号也要跟着改。",
    portLabel: "远程端口",
    service: "服务",
    serviceHint: "在手机或另一台电脑的浏览器里接着用同一批会话。服务端跑在这台机器上，默认整个关着。",
    enable: "开启",
    reading: "正在读…",
    toggle: "远程访问",
  },
  {
    listeningError: (error) => `Listening, but the config has a problem: ${error}`,
    cantStart: (error) => `Can't start: ${error}`,
    off: "Off. When on, it only listens on loopback and isn't exposed to the internet on its own",
    listening: (port) => `Listening on 127.0.0.1:${String(port)}`,
    notListening: "On, but not listening",
    port: "Port",
    portBad: "Needs a whole number from 0 to 65535. Changing it restarts the server once; connected devices need to refresh.",
    portHint: "The loopback port. 0 = let the system pick a free one. Changing it restarts the server once, and the tunnel command needs the new number.",
    portLabel: "Remote port",
    service: "Service",
    serviceHint: "Keep using the same threads from a browser on your phone or another computer. The server runs on this Mac and is off by default.",
    enable: "On",
    reading: "Reading…",
    toggle: "Remote access",
  },
)
