import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { createTally, dateOf, digestOf, foldThread } from "./activity-fold.js"

/** 本机时区的某一天早上九点。**故意不用 UTC 边界值**——分桶就是按本机日历算的。 */
const day = (date: string, hour = 9): number => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00`)

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "t1", title: "改设置页", cwd: "/w/omni", engine: "claude", trust: "auto-edit",
  status: "idle", createdAt: day("2026-08-01"), updatedAt: day("2026-08-01"), engineHistory: ["claude"],
  ...over,
})

const started = (at: number, over: Partial<Thread> = {}): Event =>
  ({ type: "thread.started", at, thread: thread({ ...over, updatedAt: at }) })

const turn = (at: number, engine = "claude"): Event =>
  ({ type: "turn.started", at, turn: { id: `u${String(at)}`, threadId: "t1", engine, status: "running", startedAt: at } })

const item = (at: number, it: Item): Event => ({ type: "item.started", at, item: it })

const said = (at: number, text: string): Event =>
  item(at, { id: `i${String(at)}`, turnId: "u", kind: "user_message", at, text })

const tool = (at: number, name: string): Event =>
  item(at, { id: `i${String(at)}`, turnId: "u", kind: "tool_call", at, tool: name, status: "ok", detail: { kind: "other", name } })

const used = (at: number, total: number, engine = "claude"): Event =>
  ({ type: "usage.updated", at, threadId: "t1", engine, usage: { contextUsed: 100, totalTokens: total } })

const digest = (events: readonly Event[], now = day("2026-08-24")) => {
  const tally = createTally()
  foldThread(tally, events)
  return digestOf(tally, { skipped: 0, ms: 0, now })
}

describe("按本机时区分桶", () => {
  // UTC 切法会把东八区早上八点前的活动记到前一天去
  const cases = [
    { name: "凌晨一点仍算当天", at: day("2026-08-03", 1), want: "2026-08-03" },
    { name: "深夜十一点仍算当天", at: day("2026-08-03", 23), want: "2026-08-03" },
    { name: "跨月补零", at: day("2026-09-01", 12), want: "2026-09-01" },
  ] as const
  for (const c of cases) {
    it(c.name, () => {
      expect(dateOf(c.at)).toBe(c.want)
    })
  }
})

describe("token 按差值算", () => {
  const cases = [
    {
      name: "累计值的差才是这一次花掉的",
      events: [used(day("2026-08-01"), 1000), used(day("2026-08-01"), 2500), used(day("2026-08-02"), 4000)],
      tokens: 4000,
      perDay: { "2026-08-01": 2500, "2026-08-02": 1500 },
    },
    {
      // 重启之后续跑：引擎开了新的原生会话，从头数
      name: "数字变小时当成新会话从头数，不记成负数",
      events: [used(day("2026-08-01"), 900_000), used(day("2026-08-02"), 3000)],
      tokens: 903_000,
      perDay: { "2026-08-01": 900_000, "2026-08-02": 3000 },
    },
    {
      name: "usage.cleared 之后基准归零",
      events: [
        used(day("2026-08-01"), 5000),
        { type: "usage.cleared", at: day("2026-08-02"), threadId: "t1", engine: "claude" } as Event,
        used(day("2026-08-02"), 800),
      ],
      tokens: 5800,
      perDay: { "2026-08-01": 5000, "2026-08-02": 800 },
    },
    {
      name: "两家引擎各记各的账，不互相当基准",
      events: [used(day("2026-08-01"), 5000, "claude"), used(day("2026-08-01"), 700, "codex")],
      tokens: 5700,
      perDay: { "2026-08-01": 5700 },
    },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      const out = digest([started(day("2026-08-01")), ...c.events])
      expect(out.totals.tokens).toBe(c.tokens)
      expect(Object.fromEntries(out.days.map((d) => [d.date, d.tokens]))).toEqual(c.perDay)
    })
  }
})

describe("排行榜", () => {
  it("模型与思考档记的是这一轮开始时的那两个值", () => {
    const out = digest([
      started(day("2026-08-01"), { model: "opus", effort: "high" }),
      turn(day("2026-08-01")),
      { type: "thread.updated", at: day("2026-08-02"), thread: thread({ model: "sonnet", effort: "low" }) },
      turn(day("2026-08-02")),
      turn(day("2026-08-02")),
    ])
    expect(out.models).toEqual([{ id: "sonnet", count: 2 }, { id: "opus", count: 1 }])
    expect(out.efforts).toEqual([{ id: "low", count: 2 }, { id: "high", count: 1 }])
  })

  // 报不上来就不记，**不塞一个「默认」进去**
  it("从不报模型的引擎不会在榜上堆出一个不存在的名字", () => {
    const out = digest([started(day("2026-08-01")), turn(day("2026-08-01"), "grok")])
    expect(out.models).toEqual([])
    expect(out.engines).toEqual([{ id: "grok", count: 1 }])
  })

  it("斜杠命令按输入原文算，只取命令名", () => {
    const out = digest([
      started(day("2026-08-01")),
      said(day("2026-08-01"), "/code-review high 帮我看看"),
      said(day("2026-08-01"), "/code-review"),
      said(day("2026-08-01"), "顺手改一下标题"),
    ])
    expect(out.commands).toEqual([{ id: "code-review", count: 2 }])
    expect(out.totals.asks).toBe(3)
  })

  it("换引擎的交接说明是 omni 附的，不算一次提问", () => {
    const at = day("2026-08-01")
    const note = item(at + 1, { id: "h", turnId: "u", kind: "user_message", at: at + 1, text: "<omni-handoff>…</omni-handoff>", origin: "handoff" })
    const out = digest([started(at), note, said(at + 2, "接着弄")])
    expect(out.totals.asks).toBe(1)
  })

  it("工具按引擎给的原名计数，并且按天也留一份", () => {
    const out = digest([started(day("2026-08-01")), tool(day("2026-08-01"), "Bash"), tool(day("2026-08-01"), "Bash"), tool(day("2026-08-02"), "Read")])
    expect(out.tools).toEqual([{ id: "Bash", count: 2 }, { id: "Read", count: 1 }])
    expect(out.totals.tools).toBe(3)
    expect(out.days.map((d) => d.tools)).toEqual([2, 1])
  })

  it("跑过却一次都没报用量的引擎单独列出来——不能让它看起来像没干活", () => {
    const out = digest([started(day("2026-08-01")), turn(day("2026-08-01"), "grok"), turn(day("2026-08-01"), "claude"), used(day("2026-08-01"), 500, "claude")])
    expect(out.tokenless).toEqual(["grok"])
  })

  it("token 分家记：各家口径不同，界面要摆得出分开的那一份", () => {
    const out = digest([
      started(day("2026-08-01")),
      used(day("2026-08-01"), 250, "claude"),
      used(day("2026-08-01"), 900, "kimi"),
      used(day("2026-08-02"), 1500, "kimi"),
    ])
    expect(out.tokensByEngine).toEqual([{ id: "kimi", count: 1500 }, { id: "claude", count: 250 }])
    expect(out.totals.tokens).toBe(1750)
  })

  // 老记录的 usage.updated 没有 engine 字段。拿 undefined 当键的话，那 250 万 token 会
  // 记到一个叫「undefined」的引擎名下，而 claude 反倒出现在「跑过却没报用量」的名单里
  it("老记录缺 engine 时落到会话当前那家，不记成一个叫 undefined 的引擎", () => {
    const legacy = { type: "usage.updated", at: day("2026-08-01"), threadId: "t1", usage: { contextUsed: 9, totalTokens: 4200 } } as unknown as Event
    const out = digest([started(day("2026-08-01")), turn(day("2026-08-01")), legacy])
    expect(out.tokensByEngine).toEqual([{ id: "claude", count: 4200 }])
    expect(out.tokenless).toEqual([])
  })
})

describe("连续天数", () => {
  const on = (dates: readonly string[]): readonly Event[] => [
    started(day(dates[0] ?? "2026-08-01")),
    ...dates.map((d) => turn(day(d))),
  ]
  const cases = [
    { name: "今天动过就从今天算", dates: ["2026-08-22", "2026-08-23", "2026-08-24"], streak: 3 },
    // 早上打开 omni 看见「连续 0 天」而昨天干到半夜，那不是事实
    { name: "今天还没动、昨天动过，仍然算连着", dates: ["2026-08-22", "2026-08-23"], streak: 2 },
    { name: "断过一天就重新起算", dates: ["2026-08-20", "2026-08-23", "2026-08-24"], streak: 2 },
    { name: "上次是前天，链子已经断了", dates: ["2026-08-21", "2026-08-22"], streak: 0 },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      const out = digest(on(c.dates))
      expect(out.totals.streak).toBe(c.streak)
      expect(out.totals.activeDays).toBe(c.dates.length)
    })
  }

  it("最长连续取历史上最长的那一段，和当前无关", () => {
    const out = digest(on(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-20"]))
    expect(out.totals.bestStreak).toBe(4)
    expect(out.totals.streak).toBe(0)
  })
})

describe("整份统计", () => {
  it("空记录不算一条会话", () => {
    const tally = createTally()
    foldThread(tally, [])
    expect(digestOf(tally, { skipped: 1, ms: 0, now: day("2026-08-24") }).threads).toBe(0)
  })

  it("跨度、旁路、接力、工作区各记各的", () => {
    const tally = createTally()
    foldThread(tally, [
      started(day("2026-08-01", 9), {
        segments: [
          { engine: "claude", handle: "a", startedAt: 1 },
          { engine: "codex", handle: "b", startedAt: 2 },
        ],
      }),
      { type: "lane.updated", at: day("2026-08-01", 10), threadId: "t1", lane: { id: "l1", threadId: "t1", kind: "activity", title: "子 agent", status: "done", at: 1 } },
      { type: "lane.updated", at: day("2026-08-01", 11), threadId: "t1", lane: { id: "l1", threadId: "t1", kind: "activity", title: "子 agent", status: "done", at: 1 } },
      item(day("2026-08-01", 12), { id: "a1", turnId: "u", kind: "approval", at: 1, toolCallId: "c", tool: "Bash", summary: "rm", status: "allowed", reason: "写盘" }),
    ])
    foldThread(tally, [started(day("2026-08-02"), { id: "t2", cwd: "/w/other" })])
    const out = digestOf(tally, { skipped: 0, ms: 0, now: day("2026-08-24") })
    expect(out.totals.threads).toBe(2)
    // 同一条 lane 报两遍还是一条
    expect(out.totals.lanes).toBe(1)
    expect(out.totals.handoffs).toBe(1)
    expect(out.totals.approvals).toBe(1)
    expect(out.totals.projects).toBe(2)
    expect(out.totals.longest).toEqual({ ms: 3 * 3600_000, title: "改设置页" })
  })
})
