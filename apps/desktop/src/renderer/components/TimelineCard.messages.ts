import { defineMessages } from "@switchback/i18n"

const EN_WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** 引擎时间线：这条会话每一段由谁跑、原始记录在哪。 */
export const TIMELINE_CARD = defineMessages(
  {
    title: "引擎时间线",
    empty: "还没有跑过。说一句话之后，这里会记下是哪家引擎跑的、记录在哪。",
    sessionId: "会话 id",
    noLog: "这家引擎没有提供本地记录的路径。",
    log: "记录",
    copyOf: (label: string) => `复制${label}`,
    copy: "复制",
    reveal: "在访达中显示",
    when: (at: number) => {
      const d = new Date(at)
      const p = (n: number): string => String(n).padStart(2, "0")
      return `${String(d.getMonth() + 1)}月${String(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}`
    },
  },
  {
    title: "Engine timeline",
    empty: "Nothing has run yet. After your first message, this shows which engine ran and where its log is.",
    sessionId: "Session ID",
    noLog: "This engine doesn't provide a local log path.",
    log: "Log",
    copyOf: (label) => `Copy ${label}`,
    copy: "Copy",
    reveal: "Show in Finder",
    when: (at) => EN_WHEN.format(at),
  },
)
