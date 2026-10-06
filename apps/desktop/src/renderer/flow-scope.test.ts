import { describe, expect, it } from "vitest"
import type { Event, Item, Turn } from "@switchback/protocol"
import { createPaceBook, estimateTokens, livePace } from "@switchback/store"
import { absorb, createScope, drain, retarget } from "./flow-scope.js"
import { createTapeText, nextChar } from "./tape-text.js"
import { createMeter, rateOf } from "./throughput.js"

const turn = (id: string, threadId: string): Event => ({
  type: "turn.started",
  at: 0,
  turn: { id, threadId, engine: "kimi", status: "running", startedAt: 0 } as Turn,
})
const item = (id: string, turnId: string, kind = "agent_message"): Event => ({
  type: "item.started",
  at: 0,
  item: { id, turnId, kind, at: 0, text: "" } as unknown as Item,
})
const delta = (itemId: string, append: string): Event => ({ type: "item.delta", at: 0, itemId, append })

/** `absorb` 返回一件事而不是一个数——这几条用例问的是「算了多少（估出来的）token」。 */
const tokensOf = (beat: ReturnType<typeof absorb>): number => (beat.kind === "text" ? beat.tokens : 0)

describe("absorb", () => {
  it("认得当前会话这一轮里的字", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("i1", "r1"))
    expect(tokensOf(absorb(s, delta("i1", "hello")))).toBeCloseTo(estimateTokens("hello"), 9)
  })

  it("别的会话在后台跑，一个字都不算——画面不能说一件没在这儿发生的事", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r9", "t2")) // 另一条会话开了一轮
    absorb(s, item("i9", "r9"))
    expect(tokensOf(absorb(s, delta("i9", "hello")))).toBe(0)
  })

  it("换轮就清空：流速回答的是「此刻」，而此刻最多属于一轮", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("i1", "r1"))
    absorb(s, turn("r2", "t1"))
    expect(tokensOf(absorb(s, delta("i1", "old")))).toBe(0)
    absorb(s, item("i2", "r2"))
    expect(tokensOf(absorb(s, delta("i2", "new")))).toBeCloseTo(estimateTokens("new"), 9)
  })

  it("没见过的 item 不算——delta 上没有身份，猜一个比不算更糟", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    expect(tokensOf(absorb(s, delta("ghost", "hello")))).toBe(0)
  })

  it("集合有上限，不会无限长大", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    for (let i = 0; i < 2000; i++) absorb(s, item(`i${String(i)}`, "r1"))
    expect(s.items.size).toBeLessThanOrEqual(512)
  })
})

describe("retarget", () => {
  it("换会话时清掉上一条的轮次与 item", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("i1", "r1"))
    retarget(s, "t2")
    expect(s.turn).toBeUndefined()
    expect(tokensOf(absorb(s, delta("i1", "hello")))).toBe(0)
  })

  it("目标没变时不做无谓的清空", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("i1", "r1"))
    retarget(s, "t1")
    expect(tokensOf(absorb(s, delta("i1", "hi")))).toBeCloseTo(estimateTokens("hi"), 9)
  })
})

describe("drain", () => {
  const seal = (event: Event, seq: number): { seq: number; event: Event } => ({ seq, event })

  it("一批事件走完，属于这条会话的字进了流速表", () => {
    const s = createScope()
    const m = createMeter()
    retarget(s, "t1")
    drain(s, { meter: m, book: createPaceBook() }, [seal(turn("r1", "t1"), 1), seal(item("i1", "r1"), 2), seal(delta("i1", "x".repeat(384)), 3)], 1000)
    expect(rateOf(m, 1000)).toBeGreaterThan(0)
  })

  it("别的会话那一批一个字都不记", () => {
    const s = createScope()
    const m = createMeter()
    retarget(s, "t1")
    drain(s, { meter: m, book: createPaceBook() }, [seal(turn("r9", "t2"), 1), seal(item("i9", "r9"), 2), seal(delta("i9", "x".repeat(999)), 3)], 1000)
    expect(rateOf(m, 1000)).toBe(0)
  })

  it("一批只记一笔——主进程已经合过帧，逐条记会把同一批字撑成假峰值", () => {
    const one = createMeter()
    const many = createMeter()
    const s1 = createScope()
    const s2 = createScope()
    retarget(s1, "t1")
    retarget(s2, "t1")
    const head = [seal(turn("r1", "t1"), 1), seal(item("i1", "r1"), 2)]
    const body = Array.from({ length: 8 }, (_, i) => seal(delta("i1", "x".repeat(48)), i + 3))
    drain(s1, { meter: one, book: createPaceBook() }, [...head, ...body], 1000)
    for (const [i, ev] of [...head, ...body].entries()) drain(s2, { meter: many, book: createPaceBook() }, [ev], 1000 + i)
    // 同样的字、同样的窗口（都在 1200ms 内）：合成一笔和拆成八笔算出来的必须一样
    expect(rateOf(one, 1100)).toBeCloseTo(rateOf(many, 1100), 6)
  })

  it("这一批里没有属于自己的字就什么都不记", () => {
    const s = createScope()
    const m = createMeter()
    retarget(s, "t1")
    drain(s, { meter: m, book: createPaceBook() }, [seal(turn("r1", "t1"), 1)], 1000)
    expect(m.last).toBeLessThan(0)
  })
})

describe("只认模型自己说的话", () => {
  it("**工具输出一个字都不算**——`pnpm build` 刷屏时模型一个 token 都没生成", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("sh", "r1", "tool_call"))
    // 早先这里会算出上万字节，于是流速飙上天、枪打成加特林
    expect(tokensOf(absorb(s, delta("sh", "x".repeat(9999))))).toBe(0)
  })

  it("推理算——**它就在 output_tokens 里**，不收的话校准两边对不上", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("th", "r1", "reasoning"))
    expect(tokensOf(absorb(s, delta("th", "думаю")))).toBeGreaterThan(0)
  })

  it("同一轮里工具在刷屏、模型也在说话，只有后者进账", () => {
    const s = createScope()
    retarget(s, "t1")
    absorb(s, turn("r1", "t1"))
    absorb(s, item("sh", "r1", "tool_call"))
    absorb(s, item("say", "r1"))
    expect(tokensOf(absorb(s, delta("sh", "x".repeat(500))))).toBe(0)
    expect(tokensOf(absorb(s, delta("say", "hi")))).toBeCloseTo(estimateTokens("hi"), 9)
  })
})

describe("节奏账本：每一条都交给它，时刻用事件自己的 `at`", () => {
  const seal = (event: Event, seq: number): { seq: number; event: Event } => ({ seq, event })
  const said = (itemId: string, at: number): Event => ({ type: "item.delta", at, itemId, append: "分页照搬" })

  it("和宿主同一个算法、同一个钟：一整批一起收到，读数照样按每条事件发生的时刻量", () => {
    const s = createScope()
    const book = createPaceBook()
    retarget(s, "t1")
    const body = [100, 300, 500, 700, 900, 1100].map((at, i) => seal(said("i1", at), i + 3))
    drain(s, { meter: createMeter(), book }, [seal(turn("r1", "t1"), 1), seal(item("i1", "r1"), 2), ...body], 5000)
    // 后五批 15 个 token / 1 秒——和收到的时刻（全是 5000）无关
    expect(livePace(book, "t1")?.tps).toBeCloseTo(15, 9)
  })

  it("别的会话也记：账本自己按会话分，切回那一条时它那一轮还接得上", () => {
    const s = createScope()
    const book = createPaceBook()
    const meter = createMeter()
    retarget(s, "t1")
    const body = [100, 300, 500, 700, 900, 1100].map((at, i) => seal(said("i9", at), i + 3))
    drain(s, { meter, book }, [seal(turn("r9", "t2"), 1), seal(item("i9", "r9"), 2), ...body], 5000)
    expect(livePace(book, "t2")?.tps).toBeCloseTo(15, 9)
    // 滑窗和纸带仍然只跟眼前这一条
    expect(rateOf(meter, 5000)).toBe(0)
  })
})

describe("纸带上落的字", () => {
  const seal = (event: Event, seq: number): { seq: number; event: Event } => ({ seq, event })

  it("落的是模型刚写出来的字，空白不落", () => {
    const s = createScope()
    const tape = createTapeText()
    retarget(s, "t1")
    drain(s, { meter: createMeter(), book: createPaceBook(), tape }, [seal(turn("r1", "t1"), 1), seal(item("i1", "r1"), 2), seal(delta("i1", "分页 a;"), 3)], 1000)
    expect([nextChar(tape), nextChar(tape), nextChar(tape), nextChar(tape)]).toEqual(["分", "页", "a", ";"])
  })

  it("工具刷的屏不进纸带", () => {
    const s = createScope()
    const tape = createTapeText()
    retarget(s, "t1")
    drain(s, { meter: createMeter(), book: createPaceBook(), tape }, [seal(turn("r1", "t1"), 1), seal(item("sh", "r1", "tool_call"), 2), seal(delta("sh", "npm WARN"), 3)], 1000)
    expect(tape.chars).toEqual([])
  })
})

