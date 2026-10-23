import { count, defineMessages } from "@switchback/i18n"

const EN_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
const EN_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

/** 设置 → 活动：顶上那几块数字与说明。 */
export const SETTINGS_ACTIVITY = defineMessages(
  {
    threads: "会话",
    threadsUnit: "条",
    turns: "轮次",
    turnsUnit: "轮",
    turnsHint: "一轮 = 从你发出一句话到引擎交还控制权",
    longest: "最长的一条会话",
    longestHint: (title: string) => `《${title}》从第一条记录到最后一条`,
    streak: "当前连续",
    daysUnit: "天",
    streakHint: "今天还没动、但昨天动过，仍然算连着",
    best: "最长连续",
    noRecords: "还没有任何记录",
    leadBefore: "统计的是 ",
    leadStrong: "Switchback 自己记下的那些会话",
    leadOpen: "（",
    dataDir: "数据目录/threads",
    leadRecords: (n: number, span: string) => ` 里的 ${String(n)} 条记录，${span}）——`,
    leadStrong2: "这是你在 Switchback 里的工作量，不是账单",
    leadEnd: "。",
    skipped: (n: number) => ` 有 ${String(n)} 条记录读不动，已跳过。`,
    more: "你在终端里直接跑引擎的那些不在这儿，引擎自己的账单 Switchback 也读不到。",
    stamp: (at: number, withYear: boolean) => {
      const d = new Date(at)
      const day = `${String(d.getMonth() + 1)} 月 ${String(d.getDate())} 日`
      return withYear ? `${String(d.getFullYear())} 年 ${day}` : day
    },
    span: (from: string, to: string) => `${from}—${to}`,
    failed: "读不出活动统计。这一页要把会话记录整个走一遍，可以稍后再试。",
    loading: "正在把会话记录走一遍…",
    refreshFailed: "刚才那次重新统计没成功，下面还是上一次的结果。",
    took: (n: number, ms: number) => `走完这 ${String(n)} 条记录用了 ${String(ms)} ms`,
    counting: "统计中…",
    recount: "重新统计",
  },
  {
    threads: "Threads",
    threadsUnit: "",
    turns: "Turns",
    turnsUnit: "",
    turnsHint: "A turn runs from your message until the engine hands control back",
    longest: "Longest thread",
    longestHint: (title) => `“${title}”, from its first record to its last`,
    streak: "Current streak",
    daysUnit: "days",
    streakHint: "Still counts if you haven't worked today but did yesterday",
    best: "Longest streak",
    noRecords: "no records yet",
    leadBefore: "These numbers cover ",
    leadStrong: "the threads Switchback recorded itself",
    leadOpen: " (",
    dataDir: "data folder/threads",
    leadRecords: (n, span) => `: ${count(n, "record")}, ${span}). `,
    leadStrong2: "This is your work in Switchback, not a bill",
    leadEnd: ".",
    skipped: (n) => ` ${count(n, "record")} couldn't be read and ${n === 1 ? "was" : "were"} skipped.`,
    more: "Engines you run directly in a terminal aren't included, and Switchback can't read the engines' own billing.",
    stamp: (at, withYear) => (withYear ? EN_DATE : EN_DAY).format(at),
    span: (from, to) => `${from} – ${to}`,
    failed: "Couldn't load activity stats. This page reads through every thread record; try again later.",
    loading: "Reading through the thread records…",
    refreshFailed: "The last recount didn't finish; these are the previous results.",
    took: (n, ms) => `Read ${count(n, "record")} in ${String(ms)} ms`,
    counting: "Counting…",
    recount: "Recount",
  },
)
