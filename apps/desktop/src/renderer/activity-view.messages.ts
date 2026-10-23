import { defineMessages } from "@switchback/i18n"

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const
const EN_BIG = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const trim = (n: number): string => n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/u, "")

/**
 * 活动统计里的数字、日期与时长。中文按万、亿进位（「12.3 万」），英文用 K / M（「123K」）——
 * 各自是那种语言里读大数的习惯，一份格式化硬套两种语言都别扭。
 */
export const ACTIVITY_VIEW = defineMessages(
  {
    month: (index: number) => `${String(index + 1)}月`,
    big: (n: number) =>
      n < 10_000 ? String(Math.round(n)) : n < 100_000_000 ? `${trim(n / 10_000)} 万` : `${trim(n / 100_000_000)} 亿`,
    minute: "分",
    hour: "小时",
    day: "天",
    tailMinutes: (n: number) => `${String(n)} 分`,
    tailHours: (n: number) => `${String(n)} 小时`,
    date: (month: number, day: number) => `${String(month)}月${String(day)}日`,
  },
  {
    month: (index) => EN_MONTHS[index] ?? "",
    big: (n) => (n < 10_000 ? String(Math.round(n)) : EN_BIG.format(n)),
    minute: "min",
    hour: "h",
    day: "d",
    tailMinutes: (n) => `${String(n)} min`,
    tailHours: (n) => `${String(n)} h`,
    date: (month, day) => `${EN_MONTHS[month - 1] ?? ""} ${String(day)}`,
  },
)
