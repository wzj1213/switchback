import { count, defineMessages } from "@switchback/i18n"

const EN_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

/** 「别处的历史」：各家引擎自己记着、还没进 Switchback 的会话。 */
export const FOREIGN = defineMessages(
  {
    title: (cwd: string, profile: string | undefined) =>
      `${cwd}${profile === undefined ? "" : `\nDSH profile：${profile}`}\n在 Switchback 里接着聊`,
    justNow: "刚刚",
    minutesAgo: (n: number) => `${String(n)} 分钟前`,
    hoursAgo: (n: number) => `${String(n)} 小时前`,
    daysAgo: (n: number) => `${String(n)} 天前`,
    day: (at: number) => {
      const d = new Date(at)
      return `${String(d.getMonth() + 1)}月${String(d.getDate())}日`
    },
    history: (engine: string) => `${engine} 历史`,
    empty: (engine: string) => `在 Switchback 里开一个 ${engine} 会话之后，你在终端或别处跑过的会列在这里。`,
    latest: (max: number, engine: string) => `只列最近 ${String(max)} 条。更早的去 ${engine} 里找。`,
  },
  {
    title: (cwd, profile) => `${cwd}${profile === undefined ? "" : `\nDSH profile: ${profile}`}\nContinue in Switchback`,
    justNow: "just now",
    minutesAgo: (n) => `${String(n)}m ago`,
    hoursAgo: (n) => `${String(n)}h ago`,
    daysAgo: (n) => `${String(n)}d ago`,
    day: (at) => EN_DAY.format(at),
    history: (engine) => `${engine} history`,
    empty: (engine) =>
      `Once you open a ${engine} thread in Switchback, the ones you ran in a terminal or elsewhere show up here.`,
    latest: (max, engine) => `Showing the latest ${count(max, "thread")}. Find older ones in ${engine}.`,
  },
)
