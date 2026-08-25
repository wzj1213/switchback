import type { ActivityDay, ActivityMetric } from "../shared/activity.js"

/**
 * 「活动」那一页的取数与排版。**纯函数，不碰 React、不读时钟**——
 * 时间由调用方传进来，所以整套几何能用一张表穷举测试。
 */

export type HeatMode = "daily" | "weekly" | "total"

export interface HeatCell {
  date: string
  /** 当前口径下这一格的值。**不一定是当天的量**——见 `HeatMode`。 */
  value: number
  /** 0 = 空。1–4 是四档深浅，按可见窗口里的**名次**分，不按大小等分（见 `levelsOf`）。 */
  level: 0 | 1 | 2 | 3 | 4
  /** 那天到底发生了什么。空日子缺席，界面据此说「这天没动」。 */
  day?: ActivityDay
}

export interface HeatGrid {
  /** 一列一周，周一在上。**列数随数据长短变**，见 `gridOf`。 */
  weeks: readonly (readonly HeatCell[])[]
  /** 月份标签：`week` 是列号。同一个月只标一次，标在它第一次出现的那列。 */
  months: readonly { week: number; label: string }[]
}

const DAY = 86_400_000
/** 最少画多久。**新用户不该看见一张 96% 空着的年历**——那看起来像坏了。 */
const MIN_WEEKS = 12
/** 最多画多久。再长一格就宽过面板了。 */
const MAX_WEEKS = 53

export function metricOf(day: ActivityDay, metric: ActivityMetric): number {
  if (metric === "turns") return day.turns
  if (metric === "asks") return day.asks
  if (metric === "tools") return day.tools
  return day.tokens
}

/** 本机时区的 `YYYY-MM-DD`。和主进程分桶用的是同一套算法（`activity-fold.ts`）。 */
export function dateOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** 退到这一周的周一。**周一在上**：中文语境里一周从周一起算，和侧栏的日期分组一致。 */
function mondayOf(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  // getDay()：周日是 0。往前退到周一 = 退 (day + 6) % 7 天
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/**
 * 画多少周。
 *
 * **跟着数据长短变，不写死一年。** 一个用了两周的人看见一张 51 列全空的年历，
 * 第一反应是「这个图坏了」，而不是「我才刚开始用」。所以：至少 12 周，
 * 有更长的历史就跟着长，上限 53 周（再宽就出面板了）。
 */
function weekCount(since: number | undefined, now: number): number {
  if (since === undefined) return MIN_WEEKS
  const span = Math.ceil((mondayOf(now) - mondayOf(since)) / (DAY * 7)) + 1
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, span))
}

/**
 * 四档深浅按**名次**分，不按大小等分。
 *
 * ## 为什么不是 `4 × value / max`
 *
 * 实测这台机器上的真实数据：忙的那天 2.5 亿 token，平常那几天几万。
 * 等分的结果是**整张图只剩一个黑点**，其余全被压成最浅的一档——
 * 而「这周比上周忙」正是这张图唯一想说的话。写代码的量天差地别是常态，
 * 不是异常，所以刻度必须对它免疫。
 *
 * 先去重再排名次：判据变成「有多少种不同的量级比它低」。
 * 于是最忙的那天**总是**最深一档，只有一种量级时全部算最深
 * （那时候确实没有层次可分，假装有才是撒谎）。
 */
function levelsOf(values: readonly number[]): ReadonlyMap<number, HeatCell["level"]> {
  const ranks = [...new Set(values.filter((v) => v > 0))].sort((a, b) => a - b)
  const span = ranks.length - 1
  return new Map(
    ranks.map((value, index) => [
      value,
      (span <= 0 ? 4 : 1 + Math.floor((3 * index) / span)) as HeatCell["level"],
    ]),
  )
}

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]

/**
 * 三种口径**共用同一副骨架**。
 *
 * 切换时格子的位置、数量、大小一个都不动，只有颜色变——面板不会跳一下。
 * 这是这块面板一贯的规矩（尺寸钉死，内容后到不撑高），在这里正好也是最好读的做法：
 * 「同一天，换个口径看」比「换一张图」信息量大。
 */
function valueOf(mode: HeatMode, per: readonly number[], index: number, weekStart: number): number {
  if (mode === "daily") return per[index] ?? 0
  if (mode === "total") return per.slice(0, index + 1).reduce((sum, v) => sum + v, 0)
  return per.slice(weekStart, weekStart + 7).reduce((sum, v) => sum + v, 0)
}

export function gridOf(
  days: readonly ActivityDay[],
  options: { metric: ActivityMetric; mode: HeatMode; now: number },
): HeatGrid {
  const byDate = new Map(days.map((day) => [day.date, day]))
  const weeks = weekCount(days[0] === undefined ? undefined : Date.parse(`${days[0].date}T00:00:00`), options.now)
  const start = mondayOf(options.now) - (weeks - 1) * 7 * DAY
  const dates = Array.from({ length: weeks * 7 }, (_, i) => dateOf(start + i * DAY))
  const per = dates.map((date) => {
    const day = byDate.get(date)
    return day === undefined ? 0 : metricOf(day, options.metric)
  })
  const values = dates.map((_, i) => valueOf(options.mode, per, i, Math.floor(i / 7) * 7))
  const levels = levelsOf(values)
  const cells = dates.map((date, i) => {
    const day = byDate.get(date)
    const value = values[i] ?? 0
    return { date, value, level: levels.get(value) ?? 0, ...(day === undefined ? {} : { day }) }
  })
  return {
    weeks: Array.from({ length: weeks }, (_, w) => cells.slice(w * 7, w * 7 + 7)),
    months: monthsOf(dates, weeks),
  }
}

/**
 * 一个月至少要占这么多列才标得出名字。
 *
 * 标签只占一格宽、靠溢出显示（见 `settings-activity.css` 的 `.heat__month`），
 * 而「10月」三个字比三格还宽。**头尾那两个月几乎必然是残月**——
 * 起点落在月中，第一个月就只有一两列，于是它的名字直接压在下一个月的名字上。
 * 实测「8月」和「9月」印成了一团。
 */
const MONTH_COLS = 3

/**
 * 月份标签。**同一个月只标一次**，标在它出现的第一列——重复标签只会糊成一条。
 * 同理，**占不满三列的月份干脆不标**：糊成一团的两个名字比少一个名字糟得多。
 */
function monthsOf(dates: readonly string[], weeks: number): readonly { week: number; label: string }[] {
  const all: { week: number; label: string }[] = []
  for (let w = 0; w < weeks; w += 1) {
    const first = dates[w * 7]
    if (first === undefined) continue
    const month = Number(first.slice(5, 7)) - 1
    if (all.at(-1)?.label === MONTHS[month]) continue
    all.push({ week: w, label: MONTHS[month] ?? "" })
  }
  // 宽度按**到下一个标签为止**算，最后一个按到整张图右缘为止
  return all.filter((one, i) => (all[i + 1]?.week ?? weeks) - one.week >= MONTH_COLS)
}

/**
 * 大数字说成人话。**用万/亿，不用 k/M**——这一页的读者读的是中文，
 * 而 `2766446k` 这种写法既不好读也没法和别的数字比大小。
 */
export function bigNumber(n: number): string {
  if (n < 10_000) return String(Math.round(n))
  if (n < 100_000_000) return `${trim(n / 10_000)} 万`
  return `${trim(n / 100_000_000)} 亿`
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/u, "")
}

/**
 * 一段时长，**拆成三段给格子用**：大数、它的单位、剩下那点零头。
 *
 * 不返回一整串「1 天 21 小时」：那一串按大号字排出来有 130px 宽，
 * 而五个并排的格子一个只有 130px——实测直接压到了隔壁格子上。
 * 拆开之后大数仍然是大号字（那才是这一格要说的话），零头退到小号。
 *
 * **只说两级**：「1 天 21 小时」比「1 天 21 小时 3 分 9 秒」好读。
 */
export function durationParts(ms: number): { value: string; unit: string; tail?: string } {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return { value: String(minutes), unit: "分" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: String(hours), unit: "小时", tail: `${String(minutes % 60)} 分` }
  return { value: String(Math.floor(hours / 24)), unit: "天", tail: `${String(hours % 24)} 小时` }
}

/** `2026-08-24` → `8月24日`。热力图的悬停读数用，年份在那儿是噪声。 */
export function dayText(date: string): string {
  return `${String(Number(date.slice(5, 7)))}月${String(Number(date.slice(8, 10)))}日`
}
