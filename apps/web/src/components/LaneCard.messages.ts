import { defineMessages } from "@switchback/i18n"

/** 侧问卡与后台活动树。问题、回答、节点名是你和引擎写的，不翻译。 */
export const LANE_CARD = defineMessages(
  {
    status: { running: "进行中", paused: "已暂停", done: "已完成", failed: "失败" },
    node: { pending: "待处理", running: "进行中", done: "完成", failed: "失败", skipped: "跳过" },
    aside: { running: "回答中", paused: "已暂停", done: "已回答", failed: "失败" },
    unknown: "状态待确认",
    label: (question: string) => `侧问：${question}`,
    tag: (state: string) => `侧问 · ${state} · 不进正文`,
  },
  {
    status: { running: "In progress", paused: "Paused", done: "Done", failed: "Failed" },
    node: { pending: "Pending", running: "In progress", done: "Done", failed: "Failed", skipped: "Skipped" },
    aside: { running: "Answering", paused: "Paused", done: "Answered", failed: "Failed" },
    unknown: "Status unknown",
    label: (question) => `Side question: ${question}`,
    tag: (state) => `Side question · ${state} · not in the main thread`,
  },
)
