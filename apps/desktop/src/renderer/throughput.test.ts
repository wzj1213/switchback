import { describe, expect, it } from "vitest"
import { clearMeter, createMeter, mark, rateOf } from "./throughput.js"

describe("rateOf", () => {
  it("一笔都没有就是 0", () => {
    expect(rateOf(createMeter(), 1000)).toBe(0)
  })

  it("窗口里的 token 摊成每秒多少", () => {
    const m = createMeter()
    // 1.2 秒的窗口里放 1200 token → 1000 tok/s
    mark(m, 1000, 1200)
    expect(rateOf(m, 1000)).toBeCloseTo(1000, 0)
  })

  it("滑出窗口的不再算数", () => {
    const m = createMeter()
    mark(m, 1000, 3200)
    expect(rateOf(m, 1500)).toBeGreaterThan(0)
    // 1200ms 窗口，2300 时那一笔已经出去了
    expect(rateOf(m, 2300)).toBe(0)
  })

  it("静默就是 0，不是一条衰减的尾巴——没有输出就没有火力", () => {
    const m = createMeter()
    for (let i = 0; i < 20; i++) mark(m, 1000 + i * 10, 400)
    expect(rateOf(m, 1200)).toBeGreaterThan(0)
    expect(rateOf(m, 9000)).toBe(0)
  })

  it("同样多的 token，来得越密流速越高", () => {
    const dense = createMeter()
    const sparse = createMeter()
    for (let i = 0; i < 8; i++) {
      mark(dense, 1000 + i * 20, 320) // 8 笔挤在 140ms 里
      mark(sparse, 1000 + i * 250, 320) // 同样 8 笔摊到 1.75 秒
    }
    // 各自在最后一笔的时刻量：密的那份整窗都是字，稀的那份窗里只剩几笔
    expect(rateOf(dense, 1140)).toBeGreaterThan(rateOf(sparse, 2750))
  })

  it("环形缓冲写满之后覆盖最旧的，不越界也不增长", () => {
    const m = createMeter()
    for (let i = 0; i < 500; i++) mark(m, i, 32)
    expect(m.marks).toHaveLength(128)
    expect(Number.isFinite(rateOf(m, 500))).toBe(true)
  })

  it("未来的样本不算——时钟回拨时不能凭空冒出流速", () => {
    const m = createMeter()
    mark(m, 5000, 3200)
    expect(rateOf(m, 1000)).toBe(0)
  })
})

describe("clearMeter", () => {
  it("清空之后回到 0：上一条会话的流速不属于这一条", () => {
    const m = createMeter()
    mark(m, 1000, 3200)
    clearMeter(m)
    expect(rateOf(m, 1000)).toBe(0)
    expect(m.head).toBe(0)
  })
})

describe("空闲快路", () => {
  it("窗口全空时不扫环形缓冲——绝大多数帧走的是这一条", () => {
    const m = createMeter()
    mark(m, 1000, 3200)
    // 让扫描一定会算出非零：把每一格都填上「在窗口内」的样本
    for (const slot of m.marks) {
      slot.at = 9000
      slot.tokens = 999
    }
    // …但 last 还停在 1000，快路直接返回 0，证明它没去扫
    expect(rateOf(m, 9000)).toBe(0)
  })

  it("有新样本时快路让开，照常算", () => {
    const m = createMeter()
    mark(m, 9000, 1200)
    expect(rateOf(m, 9000)).toBeCloseTo(1000, 0)
  })
})
