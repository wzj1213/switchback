import { defineMessages } from "@switchback/i18n"

/** 侧问卡。问题与回答是你和引擎写的，不翻译。 */
export const ASIDE_CARD = defineMessages(
  {
    status: { running: "回答中", paused: "已暂停", done: "已回答", failed: "失败" },
    tag: "侧问 · 不进正文",
    unknown: "状态待确认",
    label: (title: string) => `侧问：${title}`,
    tagWith: (state: string) => `侧问 · ${state} · 不进正文`,
    opened: "已在工作台打开",
    view: "在工作台查看",
  },
  {
    status: { running: "Answering", paused: "Paused", done: "Answered", failed: "Failed" },
    tag: "Side question · not in the main thread",
    unknown: "Status unknown",
    label: (title) => `Side question: ${title}`,
    tagWith: (state) => `Side question · ${state} · not in the main thread`,
    opened: "Opened in workbench",
    view: "View in workbench",
  },
)
