import { describe, expect, it } from "vitest"
import { BPT_GUESS } from "./bench.js"
import { clearMeter, createMeter, mark, rateOf } from "./throughput.js"

describe("rateOf", () => {
  it("一笔都没有就是 0", () => {
    expect(rateOf(createMeter(), 1000, BPT_GUESS)).toBe(0)
  })

  it("窗口里的字节摊成每秒多少 token", () => {
    const m = createMeter()
    // 1.2 秒的窗口里放 3840 字节 → 1200 token → 1000 t/s
    mark(m, 1000, 3840)
    expect(rateOf(m, 1000, BPT_GUESS)).toBeCloseTo(1000, 0)
  })

  it("滑出窗口的不再算数", () => {
    const m = createMeter()
    mark(m, 1000, 3200)
    expect(rateOf(m, 1500, BPT_GUESS)).toBeGreaterThan(0)
    // 1200ms 窗口，2300 时那一笔已经出去了
    expect(rateOf(m, 2300, BPT_GUESS)).toBe(0)
  })

  it("静默就是 0，不是一条衰减的尾巴——没有输出就没有火力", () => {
    const m = createMeter()
    for (let i = 0; i < 20; i++) mark(m, 1000 + i * 10, 400)
    expect(rateOf(m, 1200, BPT_GUESS)).toBeGreaterThan(0)
    expect(rateOf(m, 9000, BPT_GUESS)).toBe(0)
  })

  it("同样多的字节，来得越密流速越高", () => {
    const dense = createMeter()
    const sparse = createMeter()
    for (let i = 0; i < 8; i++) {
      mark(dense, 1000 + i * 20, 320) // 8 笔挤在 140ms 里
      mark(sparse, 1000 + i * 250, 320) // 同样 8 笔摊到 1.75 秒
    }
    // 各自在最后一笔的时刻量：密的那份整窗都是字，稀的那份窗里只剩几笔
    expect(rateOf(dense, 1140, BPT_GUESS)).toBeGreaterThan(rateOf(sparse, 2750, BPT_GUESS))
  })

  it("环形缓冲写满之后覆盖最旧的，不越界也不增长", () => {
    const m = createMeter()
    for (let i = 0; i < 500; i++) mark(m, i, 32)
    expect(m.marks).toHaveLength(128)
    expect(Number.isFinite(rateOf(m, 500, BPT_GUESS))).toBe(true)
  })

  it("未来的样本不算——时钟回拨时不能凭空冒出流速", () => {
    const m = createMeter()
    mark(m, 5000, 3200)
    expect(rateOf(m, 1000, BPT_GUESS)).toBe(0)
  })
})

describe("clearMeter", () => {
  it("清空之后回到 0：上一条会话的流速不属于这一条", () => {
    const m = createMeter()
    mark(m, 1000, 3200)
    clearMeter(m)
    expect(rateOf(m, 1000, BPT_GUESS)).toBe(0)
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
      slot.bytes = 999
    }
    // …但 last 还停在 1000，快路直接返回 0，证明它没去扫
    expect(rateOf(m, 9000, BPT_GUESS)).toBe(0)
  })

  it("有新样本时快路让开，照常算", () => {
    const m = createMeter()
    mark(m, 9000, 3840)
    expect(rateOf(m, 9000, BPT_GUESS)).toBeCloseTo(1000, 0)
  })
})

describe("bpt 由调用方给", () => {
  it("同样的字节，字节/token 越大算出来的 token 越少", () => {
    const m = createMeter()
    mark(m, 1000, 3840)
    // 3.2 → 1000 t/s；4.0 → 800 t/s。**这就是写死一个常数时读数跟着语言漂的那件事**
    expect(rateOf(m, 1000, 3.2)).toBeCloseTo(1000, 0)
    expect(rateOf(m, 1000, 4)).toBeCloseTo(800, 0)
  })

  it("荒唐的常数不会算出荒唐的数：夹在 1 以上", () => {
    const m = createMeter()
    mark(m, 1000, 3840)
    expect(rateOf(m, 1000, 0)).toBe(rateOf(m, 1000, 1))
  })
})
