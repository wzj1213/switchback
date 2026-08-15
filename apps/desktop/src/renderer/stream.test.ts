import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { initialStream, received, replayed, reset, resynced, type Sealed, type Step } from "./stream.js"

const ev = (tag: string): Event => ({ type: "item.delta", at: 0, itemId: "i", append: tag })
const sealed = (...seqs: number[]): Sealed[] => seqs.map((seq) => ({ seq, event: ev(`#${String(seq)}`) }))
const tags = (step: Step): string[] =>
  step.apply.map((e) => (e.type === "item.delta" ? e.append : e.type))

describe("全量之前", () => {
  it("**什么都不应用，先攒着**——没有全量就没有基线，应用了也是错的", () => {
    const step = received(initialStream, sealed(1, 2, 3))
    expect(step.apply).toEqual([])
    expect(step.stream.pending).toHaveLength(3)
    expect(step.resyncFrom).toBeUndefined()
  })
})

describe("全量到达", () => {
  it("先应用全量，再接上攒着的增量", () => {
    const buffered = received(initialStream, sealed(6, 7))
    const step = replayed(buffered.stream, { events: [ev("全量")], resumeAt: 5 })
    expect(tags(step)).toEqual(["全量", "#6", "#7"])
    expect(step.stream.lastSeq).toBe(7)
  })

  it("**resumeAt 之前的增量一律丢**——它们已经在全量里了，再应用一遍会长出重复的 item", () => {
    const buffered = received(initialStream, sealed(3, 4, 5, 6))
    const step = replayed(buffered.stream, { events: [ev("全量")], resumeAt: 5 })
    expect(tags(step)).toEqual(["全量", "#6"])
  })

  it("攒着的和 resumeAt 之间有缺口就去补，不硬着头皮往下应用", () => {
    const buffered = received(initialStream, sealed(9, 10))
    const step = replayed(buffered.stream, { events: [], resumeAt: 5 })
    expect(step.apply).toEqual([])
    expect(step.resyncFrom).toBe(5)
    expect(step.stream.catching).toBe(true)
  })

  it("全量之后没有攒着的东西时，游标就是 resumeAt", () => {
    const step = replayed(initialStream, { events: [ev("全量")], resumeAt: 12 })
    expect(step.stream).toEqual({ lastSeq: 12, pending: [], catching: false })
  })
})

describe("常态增量", () => {
  const base = replayed(initialStream, { events: [], resumeAt: 0 }).stream

  it("连得上就应用", () => {
    const step = received(base, sealed(1, 2, 3))
    expect(tags(step)).toEqual(["#1", "#2", "#3"])
    expect(step.stream.lastSeq).toBe(3)
  })

  it("跨批也连得上", () => {
    const first = received(base, sealed(1, 2))
    const step = received(first.stream, sealed(3))
    expect(tags(step)).toEqual(["#3"])
  })

  it("**中间断了就停下来去补**，断口之后的攒着不应用", () => {
    const step = received(base, sealed(1, 2, 5, 6))
    expect(tags(step)).toEqual(["#1", "#2"])
    expect(step.resyncFrom).toBe(2)
    expect(step.stream.pending.map((s) => s.seq)).toEqual([5, 6])
  })

  it("补发期间来的继续攒，一条都不应用", () => {
    const gapped = received(base, sealed(1, 4))
    expect(gapped.stream.catching).toBe(true)
    const during = received(gapped.stream, sealed(5))
    expect(during.apply).toEqual([])
    expect(during.stream.pending.map((s) => s.seq)).toEqual([4, 5])
  })

  it("**重复的批次不会被应用两次**——去重按序号，不按内容", () => {
    const first = received(base, sealed(1, 2))
    const again = received(first.stream, sealed(1, 2, 3))
    expect(tags(again)).toEqual(["#3"])
  })
})

describe("补发回来", () => {
  it("补上缺口之后，攒着的那些自动接上", () => {
    const gapped = received(replayed(initialStream, { events: [], resumeAt: 0 }).stream, sealed(1, 5, 6))
    const step = resynced(gapped.stream, sealed(2, 3, 4))
    expect(tags(step)).toEqual(["#2", "#3", "#4", "#5", "#6"])
    expect(step.stream).toEqual({ lastSeq: 6, pending: [], catching: false })
  })

  it("补回来的还是不全就再补一次——不会卡死在 catching 上", () => {
    const gapped = received(replayed(initialStream, { events: [], resumeAt: 0 }).stream, sealed(1, 9))
    const step = resynced(gapped.stream, sealed(2, 3))
    expect(tags(step)).toEqual(["#2", "#3"])
    expect(step.resyncFrom).toBe(3)
    expect(step.stream.catching).toBe(true)
  })
})

describe("补不了", () => {
  it("回到没有基线的状态，攒着的全丢——它们连不上任何东西了", () => {
    expect(reset()).toEqual(initialStream)
  })
})
