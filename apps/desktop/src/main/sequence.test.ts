import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createSequencer } from "./sequence.js"

const ev = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: String(n) })

function feed(seq: ReturnType<typeof createSequencer>, count: number): void {
  for (let i = 1; i <= count; i += 1) seq.seal([ev(i)])
}

describe("编号", () => {
  it("从 1 开始，连续，跨批不断", () => {
    const seq = createSequencer()
    expect(seq.seal([ev(1), ev(2)]).map((s) => s.seq)).toEqual([1, 2])
    expect(seq.seal([ev(3)]).map((s) => s.seq)).toEqual([3])
    expect(seq.latest()).toBe(3)
  })

  it("空批不占号——发一个空数组不该让对方以为漏了一条", () => {
    const seq = createSequencer()
    seq.seal([ev(1)])
    expect(seq.seal([])).toEqual([])
    expect(seq.latest()).toBe(1)
  })
})

describe("补发", () => {
  it("没落后就返回空，不是 undefined——「不用补」和「补不了」是两回事", () => {
    const seq = createSequencer()
    feed(seq, 3)
    expect(seq.since(3)).toEqual([])
  })

  it("落后几条就补几条", () => {
    const seq = createSequencer()
    feed(seq, 5)
    expect(seq.since(2)?.map((s) => s.seq)).toEqual([3, 4, 5])
  })

  it("从头补：一个全新的订阅者报 0", () => {
    const seq = createSequencer()
    feed(seq, 3)
    expect(seq.since(0)?.map((s) => s.seq)).toEqual([1, 2, 3])
  })

  it("**缺口太老就明说补不了，绝不补一半**——补一半的界面看起来是好的，那才危险", () => {
    const seq = createSequencer(10)
    feed(seq, 30)
    // 缓冲里只剩 21..30，对方停在 5
    expect(seq.since(5)).toBeUndefined()
    expect(seq.since(20)?.map((s) => s.seq)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
  })

  it("**对方报的号比我们发过的还大 → 它来自上一次运行**，只能全量重来", () => {
    const seq = createSequencer()
    feed(seq, 3)
    expect(seq.since(99)).toBeUndefined()
  })

  it("一条都没发过时，落后的订阅者也补不了", () => {
    const seq = createSequencer()
    expect(seq.since(0)).toEqual([])
    expect(seq.since(1)).toBeUndefined()
  })

  it("缓冲按上限裁剪，不会无限长——补得动的恰好就是最后 ring 条", () => {
    const seq = createSequencer(10)
    feed(seq, 1000)
    expect(seq.since(990)?.length).toBe(10)
    expect(seq.since(989)).toBeUndefined()
  })
})
