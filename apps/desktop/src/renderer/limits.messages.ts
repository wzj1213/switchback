import { defineMessages } from "@switchback/i18n"

const EN_RESET = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** 账号额度那颗胶囊上的窗口与恢复时间。 */
export const LIMITS = defineMessages(
  {
    reset: (at: number) => {
      const d = new Date(at)
      return `${String(d.getMonth() + 1)}月${String(d.getDate())}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    },
    minutes: (n: number) => `${String(n)} 分钟内`,
    hours: (n: number) => `${String(n)} 小时内`,
    week: "本周",
    days: (n: number) => `${String(n)} 天内`,
  },
  {
    reset: (at) => EN_RESET.format(at),
    minutes: (n) => `${String(n)}-minute window`,
    hours: (n) => `${String(n)}-hour window`,
    week: "weekly window",
    days: (n) => `${String(n)}-day window`,
  },
)
