import type { Event, Item, Thread } from "@omni/protocol"
import type { ActivityDay, ActivityDigest, ActivityTotals, NameTally } from "../shared/activity.js"

/**
 * 把事件流折成一份统计。**纯函数，不碰磁盘、不读时钟**——
 * 时间由调用方传进来（`digestOf` 的 `now`），所以整套口径能用一张事件表穷举测试。
 *
 * 读盘在 `activity.ts`；这里只回答「这些事件意味着什么」。
 */

/** 累加器。**可变的一份，显式传进传出**，不挂模块级状态。 */
export interface Tally {
  days: Map<string, ActivityDay>
  engines: Map<string, number>
  models: Map<string, number>
  efforts: Map<string, number>
  tools: Map<string, number>
  commands: Map<string, number>
  /** 每家引擎各自报的累计用量。**分开记，因为各家口径不是一回事**（见 shared/activity.ts）。 */
  tokens: Map<string, number>
  /** 报过累计用量的引擎。 */
  tokenful: Set<string>
  /** 真跑过轮次的引擎。 */
  ran: Set<string>
  projects: Set<string>
  totals: ActivityTotals
  first: number
  last: number
}

export function createTally(): Tally {
  return {
    days: new Map(),
    engines: new Map(),
    models: new Map(),
    efforts: new Map(),
    tools: new Map(),
    commands: new Map(),
    tokens: new Map(),
    tokenful: new Set(),
    ran: new Set(),
    projects: new Set(),
    totals: {
      tokens: 0, turns: 0, threads: 0, asks: 0, tools: 0,
      approvals: 0, lanes: 0, handoffs: 0, projects: 0,
      activeDays: 0, streak: 0, bestStreak: 0,
    },
    first: 0,
    last: 0,
  }
}

/** 走一条会话时随手记的那些。**逐条会话新建**，不跨会话带状态。 */
interface Walk {
  /** 每家引擎上一次报的累计用量。差值才是这一次真花掉的。 */
  seen: Map<string, number>
  /** 这条会话当前挂在哪家。老记录的 `usage.updated` 没有 `engine` 字段，靠它兜底。 */
  engine: string
  model?: string
  effort?: string
  lanes: Set<string>
  title: string
  first: number
  last: number
  handoffs: number
}

/**
 * 本机时区的 `YYYY-MM-DD`。
 *
 * **不能用 `toISOString().slice(0,10)`**：那是 UTC 的日期，在东八区会把每天
 * 早上八点前的活动记到前一天去。热力图是照着你自己的日历读的，
 * 分桶就必须用你自己的日历。
 */
export function dateOf(at: number): string {
  const d = new Date(at)
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${String(d.getFullYear())}-${month}-${day}`
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by)
}

function dayOf(tally: Tally, at: number): ActivityDay {
  const date = dateOf(at)
  const found = tally.days.get(date)
  if (found !== undefined) return found
  const fresh: ActivityDay = { date, tokens: 0, turns: 0, asks: 0, tools: 0 }
  tally.days.set(date, fresh)
  return fresh
}

/** 会话最新的样子。标题、模型、思考档、接力次数都从这儿来。 */
function noteThread(walk: Walk, tally: Tally, thread: Thread): void {
  walk.title = thread.title
  walk.engine = thread.engine
  walk.model = thread.model
  walk.effort = thread.effort
  // 段数减一才是**换过几次**：只跑过一家的会话有一段，那不叫接力
  walk.handoffs = Math.max(0, (thread.segments?.length ?? 1) - 1)
  if (thread.cwd !== "") tally.projects.add(thread.cwd)
}

/**
 * 一轮。模型与思考档记的是**这一轮开始时**那两个值。
 *
 * 报不上来就不记，**不塞一个「默认」进去**：那会让一家从不报模型的引擎
 * 在「最常用的模型」里堆出一个并不存在的名字。
 */
function noteTurn(tally: Tally, walk: Walk, at: number, engine: string): void {
  tally.totals.turns += 1
  dayOf(tally, at).turns += 1
  if (engine !== "") {
    bump(tally.engines, engine)
    tally.ran.add(engine)
  }
  if (walk.model !== undefined) bump(tally.models, walk.model)
  if (walk.effort !== undefined) bump(tally.efforts, walk.effort)
}

/** 斜杠命令：**按你打进输入框的原文算**，不问引擎那边它叫什么。 */
function noteCommand(tally: Tally, text: string): void {
  if (!text.startsWith("/")) return
  const name = /^\/([A-Za-z0-9:_-]+)/u.exec(text)?.[1]
  if (name !== undefined) bump(tally.commands, name)
}

function noteItem(tally: Tally, at: number, item: Item): void {
  if (item.kind === "user_message") {
    // 换引擎的交接说明是 omni 附的，不算你问的
    if (item.origin === "handoff") return
    tally.totals.asks += 1
    dayOf(tally, at).asks += 1
    noteCommand(tally, item.text)
    return
  }
  if (item.kind === "tool_call") {
    tally.totals.tools += 1
    dayOf(tally, at).tools += 1
    bump(tally.tools, item.tool)
    return
  }
  if (item.kind === "approval") tally.totals.approvals += 1
}

/**
 * 用量。`totalTokens` 是**这条原生会话累计**的，所以差值才是这一次新花掉的。
 *
 * 数字变小时不当成负数，而是当成「引擎换了一条新的原生会话，从头开始数」——
 * 那时它报的这个值本身就是新花掉的量。重启之后续跑就是这个情形。
 */
function noteUsage(tally: Tally, walk: Walk, seen: { at: number; engine?: string; total: number }): void {
  const { at, total } = seen
  // 老记录的 `usage.updated` 没有 `engine`（那个字段是后加的）。**不能拿 undefined 当键**：
  // 那会把那 250 万 token 记到一个叫「undefined」的引擎名下，
  // 于是「跑过却没报过用量」的名单里凭空多出一家——一句实打实的谎
  const engine = seen.engine === undefined || seen.engine === "" ? walk.engine : seen.engine
  if (engine === "") return
  tally.tokenful.add(engine)
  const before = walk.seen.get(engine) ?? 0
  const delta = total >= before ? total - before : total
  walk.seen.set(engine, total)
  if (delta <= 0) return
  tally.totals.tokens += delta
  bump(tally.tokens, engine, delta)
  dayOf(tally, at).tokens += delta
}

function apply(tally: Tally, walk: Walk, event: Event): void {
  if (event.type === "thread.started" || event.type === "thread.updated") {
    noteThread(walk, tally, event.thread)
    return
  }
  if (event.type === "turn.started") {
    noteTurn(tally, walk, event.at, event.turn.engine)
    return
  }
  if (event.type === "item.started") {
    noteItem(tally, event.at, event.item)
    return
  }
  if (event.type === "lane.updated") {
    walk.lanes.add(event.lane.id)
    return
  }
  if (event.type === "usage.updated") {
    if (event.usage.totalTokens !== undefined)
      noteUsage(tally, walk, { at: event.at, engine: event.engine, total: event.usage.totalTokens })
    return
  }
  // 新的原生会话还没报用量：把基准清零，免得下一条被当成「一次花了几十万」
  if (event.type === "usage.cleared") walk.seen.set(event.engine || walk.engine, 0)
}

/** 一条会话。**空记录不算一条**——磁盘上留着的空文件不该顶掉一格统计。 */
export function foldThread(tally: Tally, events: readonly Event[]): void {
  const walk: Walk = { seen: new Map(), lanes: new Set(), engine: "", title: "", first: 0, last: 0, handoffs: 0 }
  for (const event of events) {
    const at = typeof event.at === "number" && event.at > 0 ? event.at : 0
    if (at > 0) {
      walk.first = walk.first === 0 ? at : Math.min(walk.first, at)
      walk.last = Math.max(walk.last, at)
    }
    apply(tally, walk, event)
  }
  if (walk.last === 0) return
  tally.totals.threads += 1
  tally.totals.lanes += walk.lanes.size
  tally.totals.handoffs += walk.handoffs
  tally.first = tally.first === 0 ? walk.first : Math.min(tally.first, walk.first)
  tally.last = Math.max(tally.last, walk.last)
  const span = walk.last - walk.first
  if (span > (tally.totals.longest?.ms ?? -1))
    tally.totals.longest = { ms: span, title: walk.title }
}

/** 排行榜。**按次数降序，同数按 id**——顺序必须是确定的，否则每次重读都在跳。 */
function rank(map: ReadonlyMap<string, number>, top: number): readonly NameTally[] {
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, top)
}

/**
 * 连续天数。
 *
 * **今天还没动不算断。** 一个人早上打开 omni 看见「连续 0 天」，
 * 而他昨天干到半夜——那不是事实，是把「还没开始」说成了「断了」。
 * 所以从今天起算，今天空着就退一天再看。
 */
function streakOf(dates: ReadonlySet<string>, now: number): number {
  const day = 86_400_000
  const start = dates.has(dateOf(now)) ? now : now - day
  if (!dates.has(dateOf(start))) return 0
  let count = 0
  let cursor = start
  while (dates.has(dateOf(cursor))) {
    count += 1
    cursor -= day
  }
  return count
}

/** 历史最长的一段连续。按日期升序走一遍，隔一天以上就重新起算。 */
function bestStreakOf(days: readonly ActivityDay[]): number {
  let best = 0
  let run = 0
  let previous: number | undefined
  for (const day of days) {
    const at = Date.parse(`${day.date}T00:00:00`)
    run = previous !== undefined && at - previous <= 86_400_000 * 1.5 ? run + 1 : 1
    previous = at
    best = Math.max(best, run)
  }
  return best
}

export function digestOf(
  tally: Tally,
  meta: { skipped: number; ms: number; now: number },
): ActivityDigest {
  const days = [...tally.days.values()].sort((a, b) => a.date.localeCompare(b.date))
  const peak = [...days].sort((a, b) => b.tokens - a.tokens || b.turns - a.turns)[0]
  const totals: ActivityTotals = {
    ...tally.totals,
    projects: tally.projects.size,
    activeDays: days.length,
    streak: streakOf(new Set(days.map((d) => d.date)), meta.now),
    bestStreak: bestStreakOf(days),
    ...(peak === undefined || peak.tokens + peak.turns === 0 ? {} : { peakDay: peak }),
  }
  return {
    threads: tally.totals.threads,
    skipped: meta.skipped,
    ms: meta.ms,
    ...(tally.first === 0 ? {} : { since: tally.first, until: tally.last }),
    days,
    totals,
    engines: rank(tally.engines, 12),
    models: rank(tally.models, 8),
    efforts: rank(tally.efforts, 8),
    tools: rank(tally.tools, 8),
    commands: rank(tally.commands, 8),
    tokensByEngine: rank(tally.tokens, 12),
    tokenless: [...tally.ran].filter((id) => !tally.tokenful.has(id)).sort(),
  }
}
