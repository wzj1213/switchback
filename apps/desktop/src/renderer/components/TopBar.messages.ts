import { count, defineMessages } from "@switchback/i18n"

/** 会话顶栏。 */
export const TOP_BAR = defineMessages(
  {
    env: "环境信息",
    detachedTip: "背后现在没有引擎进程；直接发话会先把它接回来",
    detached: "历史记录",
    relay: (legs: number) => `接力 ${String(legs)} 手`,
    resets: (at: string) => ` · ${at} 恢复`,
    quotaTip: "账号额度，不是这个会话的用量",
    exhausted: "额度已用尽",
    quota: (pct: number) => `额度 ${String(pct)}%`,
  },
  {
    env: "Environment",
    detachedTip: "No engine process is behind this thread right now. Sending a message reconnects it first.",
    detached: "Past thread",
    relay: (legs) => count(legs - 1, "handoff"),
    resets: (at) => ` · resets ${at}`,
    quotaTip: "Account quota, not this thread's usage",
    exhausted: "Quota used up",
    quota: (pct) => `Quota ${String(pct)}%`,
  },
)
