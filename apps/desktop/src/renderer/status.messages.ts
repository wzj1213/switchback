import { defineMessages } from "@switchback/i18n"

const EN_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

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
    day: (at: number) => {
      const d = new Date(at)
      return `${String(d.getMonth() + 1)} 月 ${String(d.getDate())} 日`
    },
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
    day: (at) => EN_DAY.format(at),
  },
)
