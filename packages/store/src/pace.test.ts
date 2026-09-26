import { describe, expect, it } from "vitest"
import type { Event, Item, TurnPace } from "@omni/protocol"
import { createPaceBook, livePace, notePace } from "./pace.js"
import { estimateTokens } from "./tokens.js"

const begin = (at: number, turn = "r1", thread = "t1"): Event => ({
  type: "turn.started",
  at,
  turn: { id: turn, threadId: thread, engine: "claude", status: "running", startedAt: at },
})
const end = (at: number, turn = "r1"): Event => ({ type: "turn.completed", at, turnId: turn, status: "completed" })
const say = (at: number, id: string, extra: Record<string, unknown> = {}): Event => ({
  type: "item.started",
  at,
  item: { id, turnId: "r1", at, kind: "agent_message", text: "", complete: false, ...extra } as Item,
})
const delta = (at: number, itemId: string, append: string): Event => ({ type: "item.delta", at, itemId, append })
const tool = (at: number, id: string, status = "running", type: "item.started" | "item.updated" = "item.started"): Event =>
  ({ type, at, item: { id, turnId: "r1", at, kind: "tool_call", status, title: "Read", detail: { kind: "other" } } } as unknown as Event)
const used = (at: number, outputTokens: number, threadId = "t1"): Event =>
  ({ type: "usage.updated", at, threadId, engine: "claude", usage: { contextUsed: 1, outputTokens } })

/** 四个汉字一批：估出来正好 3 个 token，算式好读。 */
const BATCH = "分页照搬"
const PER = estimateTokens(BATCH)

/** 从 `from` 起每 `every` 毫秒到一批，一共 `n` 批。 */
function stream(itemId: string, from: number, n: number, every: number): Event[] {
  return Array.from({ length: n }, (_, i) => delta(from + i * every, itemId, BATCH))
}

/** 喂完一串事件，返回收工那一条给出的节奏。 */
function play(events: readonly Event[]): TurnPace | undefined {
  const book = createPaceBook()
  const got = events.map((event) => notePace(book, event)).filter((pace) => pace !== undefined)
  return got.at(-1)
}

describe("估数（引擎没报生成量）：看得见的字 ÷ 它们在流的时间", () => {
  it("首字单列；每段的头一批不算，因为它花了多久没法量", () => {
    const pace = play([begin(1000), say(1500, "a"), ...stream("a", 1620, 11, 200), end(3800)])
    expect(PER).toBe(3)
    expect(pace?.firstMs).toBe(620)
    // 后十批 30 个 token / 2 秒
    expect(pace?.tps).toBeCloseTo(15, 9)
    expect(pace?.tokens).toBe(33)
    expect(pace?.exact).toBe(false)
  })

  it("**中间调了一次工具，哪怕只停了一秒多**，那段也不算——光看间隔会以为它一直在写", () => {
    const pace = play([
      begin(0), say(0, "a"), ...stream("a", 100, 6, 200),
      tool(1200, "k"), tool(1300, "k", "ok", "item.updated"),
      say(2300, "b"), ...stream("b", 2400, 6, 200), end(3500),
    ])
    // 两段各 1 秒、各算 5 批：30 / 2 秒
    expect(pace?.tps).toBeCloseTo(15, 9)
  })

  it("两批隔了超过 1.5 秒（它在想、或者在写看不见的参数）：那段不算", () => {
    const pace = play([begin(0), say(0, "a"), ...stream("a", 100, 6, 200), ...stream("a", 4100, 6, 200), end(5200)])
    expect(pace?.tps).toBeCloseTo(15, 9)
  })
})

describe("真数（引擎报了生成量）：按请求算，从第一个字到它收尾", () => {
  it("**看不见的生成算在里面**：写完字接着写了 5 秒工具参数，那 5 秒是出字时间", () => {
    const pace = play([
      begin(0), say(400, "a"), delta(500, "a", BATCH), delta(700, "a", BATCH), delta(900, "a", BATCH),
      tool(5900, "k"), tool(7000, "k", "ok", "item.updated"),
      say(7900, "b"), delta(8000, "b", BATCH), delta(9000, "b", BATCH),
      used(9100, 640), end(9200),
    ])
    // 第一次请求 500 → 5900，第二次 8000 → 9000：640 / 6.4 秒。工具跑的那 1.1 秒、第二次等首字的那 1 秒不算
    expect(pace?.tps).toBeCloseTo(100, 9)
    expect(pace?.tokens).toBe(640)
    expect(pace?.exact).toBe(true)
  })

  it("一个字没写就直接调工具的那次请求，从它发出去算起", () => {
    const pace = play([
      begin(0), tool(3000, "k"), tool(4000, "k", "ok", "item.updated"),
      say(4900, "a"), delta(5000, "a", BATCH), delta(6000, "a", BATCH), used(6100, 400), end(6200),
    ])
    // 0 → 3000 那次 + 5000 → 6000 那次：400 / 4 秒
    expect(pace?.tps).toBeCloseTo(100, 9)
    // 首字就是那条工具调用：它比任何一个字都早
    expect(pace?.firstMs).toBe(3000)
  })

  it("并行的几条工具调用是同一次请求：只在第一条那儿收尾一次", () => {
    const pace = play([
      begin(0), say(0, "a"), delta(1000, "a", BATCH), delta(2000, "a", BATCH),
      tool(3000, "k1"), tool(3000, "k2"), tool(3500, "k1", "ok", "item.updated"), tool(4000, "k2", "ok", "item.updated"),
      say(4900, "b"), delta(5000, "b", BATCH), delta(6000, "b", BATCH), used(6100, 300), end(6200),
    ])
    // 1000 → 3000 与 5000 → 6000：300 / 3 秒
    expect(pace?.tps).toBeCloseTo(100, 9)
  })

  it("别的会话报的用量不进这一轮", () => {
    const pace = play([begin(0), say(0, "a"), ...stream("a", 100, 6, 200), used(1200, 999, "t2"), end(1300)])
    expect(pace?.exact).toBe(false)
  })
})

describe("边界", () => {
  const cases: readonly (readonly [string, readonly Event[]])[] = [
    ["一次输出都没有的轮次不给节奏", [begin(0), end(900)]],
    ["抄过来的历史不是这一轮写的", [begin(0), say(10, "a", { text: "很长的一段旧回答", inherited: true }), end(20)]],
    ["上一轮没等到收工就开了下一轮：旧账扔掉", [begin(0), say(0, "a"), ...stream("a", 100, 6, 200), begin(2000, "r2"), end(2100)]],
  ]
  for (const [name, events] of cases) {
    it(name, () => {
      expect(play(events)).toBeUndefined()
    })
  }

  it("旁路（子 agent、侧问）是另一个 agent 在同时写：它的字不算", () => {
    const pace = play([
      begin(0), say(0, "a"), ...stream("a", 100, 6, 200),
      say(150, "side", { lane: { id: "l1" } }), ...stream("side", 160, 6, 200), end(1300),
    ])
    expect(pace?.tokens).toBe(18)
  })

  it("出字时长不够 400 毫秒不给速度，首字照给", () => {
    const pace = play([begin(0), say(0, "a"), delta(200, "a", BATCH), delta(400, "a", BATCH), end(500)])
    expect(pace?.firstMs).toBe(200)
    expect(pace?.tps).toBeUndefined()
  })

  it("整条更新只数多出来的那截；收尾那条和增量拼出来的一样长，就一个都不多数", () => {
    const grow = (at: number, text: string): Event =>
      ({ type: "item.updated", at, item: { id: "a", turnId: "r1", at, kind: "agent_message", text, complete: false } as Item })
    const pace = play([begin(0), say(100, "a", { text: "分页" }), grow(300, "分页照搬"), delta(500, "a", "要注意"), grow(600, "分页照搬要注意"), end(700)])
    expect(pace?.tokens).toBe(Math.round(estimateTokens("分页照搬要注意")))
  })
})

describe("跑着时的读数", () => {
  it("和收工时同一个算法：收工那一刻两个数一样", () => {
    const book = createPaceBook()
    const events = [begin(0), say(0, "a"), ...stream("a", 100, 11, 200)]
    for (const event of events) notePace(book, event)
    const live = livePace(book, "t1")
    const done = notePace(book, end(2300))
    expect(live?.tps).toBeCloseTo(done?.tps ?? 0, 9)
    // 收工之后这条会话没有在跑的轮次了
    expect(livePace(book, "t1")).toBeUndefined()
  })
})
