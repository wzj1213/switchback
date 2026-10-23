import { count, defineMessages } from "@switchback/i18n"

/** 侧栏行尾：状态点的读屏名、状态字、引擎点。 */
export const ROW_END = defineMessages(
  {
    unread: "跑完了，还没打开过",
    note: { waiting_approval: "待批", starting: "启动中", failed: "失败" },
    engine: (name: string, legs: number) => `现在归 ${name} 跑 · 接力 ${String(legs)} 手`,
    running: "正在运行",
    groupUnread: (n: number) => `${String(n)} 条跑完了还没看`,
    groupWaiting: (n: number) => `${String(n)} 个等你批`,
    groupRunning: (n: number) => `${String(n)} 个在跑`,
  },
  {
    unread: "Finished, not opened yet",
    note: { waiting_approval: "Needs approval", starting: "Starting", failed: "Failed" },
    engine: (name, legs) => `Now on ${name} · ${count(legs - 1, "handoff")}`,
    running: "Running",
    groupUnread: (n) => `${count(n, "thread")} finished, not opened yet`,
    groupWaiting: (n) => `${String(n)} waiting for your approval`,
    groupRunning: (n) => `${String(n)} running`,
  },
)
