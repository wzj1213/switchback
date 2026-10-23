import { defineMessages } from "@switchback/i18n"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/** 运行态、时长、「多久以前」。 */
export const STATUS = defineMessages(
  {
    waitingApproval: "等待批准",
    answering: "正在回答",
    thinking: "正在思考",
    seconds: (s: number) => `${String(s)} 秒`,
    minutes: (min: number) => `${String(min)} 分`,
    minutesSeconds: (min: number, s: number) => `${String(min)} 分 ${String(s)} 秒`,
    firstToken: (seconds: string) => `首字 ${seconds} 秒`,
    now: "现在",
    minutesAgo: (n: number) => `${String(n)} 分钟前`,
    hoursAgo: (n: number) => `${String(n)} 小时前`,
    yesterday: "昨天",
    daysAgo: (n: number) => `${String(n)} 天前`,
    day: (month: number, day: number) => `${String(month)} 月 ${String(day)} 日`,
  },
  {
    waitingApproval: "Waiting for approval",
    answering: "Responding",
    thinking: "Thinking",
    seconds: (s) => `${String(s)}s`,
    minutes: (min) => `${String(min)}m`,
    minutesSeconds: (min, s) => `${String(min)}m ${String(s)}s`,
    firstToken: (seconds) => `first token ${seconds}s`,
    now: "now",
    minutesAgo: (n) => `${String(n)}m ago`,
    hoursAgo: (n) => `${String(n)}h ago`,
    yesterday: "yesterday",
    daysAgo: (n) => `${String(n)}d ago`,
    day: (month, day) => `${MONTHS[month - 1] ?? String(month)} ${String(day)}`,
  },
)
