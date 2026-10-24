import { defineMessages } from "@switchback/i18n"

/** 会话列表、解除配对、页脚。会话标题和项目名是你起的，不翻译。 */
export const THREADS = defineMessages(
  {
    status: { starting: "正在起引擎", idle: "空闲", running: "在跑", waiting_approval: "等你确认", failed: "出错了" },
    unpair: "解除配对",
    unpairAsk: "解除后要在桌面上重新取码",
    cancel: "取消",
    unpairYes: "解除",
    detached: " · 未接引擎",
    title: "会话",
    create: "＋ 开一条",
    empty: "还没有会话。到桌面上新建一条，这里就会出现。",
    runsOn: (host: string) => ` · 在 ${host} 上跑`,
    limit: (trust: string) => ` · 远程上限 ${trust}`,
  },
  {
    status: { starting: "Starting engine", idle: "Idle", running: "Running", waiting_approval: "Needs your approval", failed: "Failed" },
    unpair: "Unpair",
    unpairAsk: "To pair again you'll need a new code from the desktop",
    cancel: "Cancel",
    unpairYes: "Unpair",
    detached: " · No engine",
    title: "Threads",
    create: "＋ New",
    empty: "No threads yet. Create one on the desktop and it shows up here.",
    runsOn: (host) => ` · on ${host}`,
    limit: (trust) => ` · remote limit ${trust}`,
  },
)
