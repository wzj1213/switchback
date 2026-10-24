import { defineMessages } from "@switchback/i18n"

/** 输入框上面那一行：现在由谁接、什么档位。引擎名和档位 id 原样显示。 */
export const THREAD_INPUT = defineMessages(
  {
    offline: "没连上 Switchback，先等重连",
    starting: "引擎正在启动，马上就能说话",
    next: (engine: string, trust: string) => `下一句由 ${engine} 接着做 · ${trust}`,
    revive: (engine: string, trust: string) => `历史会话 · 发出去先接回 ${engine}（几秒）· ${trust}`,
  },
  {
    offline: "Not connected to Switchback. Wait for it to reconnect",
    starting: "The engine is starting. You can send in a moment",
    next: (engine, trust) => `${engine} picks up the next message · ${trust}`,
    revive: (engine, trust) => `Past thread · sending resumes ${engine} first (a few seconds) · ${trust}`,
  },
)
