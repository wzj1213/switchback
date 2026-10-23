import { defineMessages } from "@switchback/i18n"

/** 侧栏行的悬停卡。 */
export const ROW_PEEK = defineMessages(
  {
    waiting: (ago: string) => `待批 · 停在 ${ago}`,
    failed: (ago: string) => `失败 · ${ago}`,
    running: "正在跑",
    starting: "启动中",
    defaultModel: "默认",
    relay: (route: string) => `接力 ${route} · `,
    created: (day: string) => `创建于 ${day}`,
  },
  {
    waiting: (ago) => `Needs approval · paused ${ago}`,
    failed: (ago) => `Failed · ${ago}`,
    running: "Running",
    starting: "Starting",
    defaultModel: "Default",
    relay: (route) => `${route} · `,
    created: (day) => `Created ${day}`,
  },
)
