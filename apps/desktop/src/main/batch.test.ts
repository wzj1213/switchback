import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Event } from "@switchback/protocol"
import { createBatcher } from "./batch.js"

const tick = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: String(n) })

describe("createBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("窗口内的多条合成一批", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((e) => sent.push(e))
    b.push(tick(1))
    b.push(tick(2))
    b.push(tick(3))
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(16)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(3)
  })

  it("顺序绝不能乱——合帧只改变什么时候发，不改变发什么", () => {
    const sent: Event[] = []
    const b = createBatcher((e) => sent.push(...e))
    for (let i = 0; i < 50; i += 1) b.push(tick(i))
    vi.advanceTimersByTime(16)
    expect(sent.map((e) => e.at)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it("攒满上限立刻发，不等窗口——合帧是为了少发几次，不是为了攒大包", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((e) => sent.push(e))
    for (let i = 0; i < 500; i += 1) b.push(tick(i))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(500)
  })

  it("flush 立刻发出攒着的——窗口关闭前不调的话最后一批会丢", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((e) => sent.push(e))
    b.push(tick(1))
    b.flush()
    expect(sent).toHaveLength(1)
  })

  it("没有攒着的东西时 flush 是无操作，不发空批", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((e) => sent.push(e))
    b.flush()
    b.flush()
    expect(sent).toEqual([])
  })

  it("flush 之后定时器要清掉，否则会补发一个空批", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((e) => sent.push(e))
    b.push(tick(1))
    b.flush()
    vi.advanceTimersByTime(100)
    expect(sent).toHaveLength(1)
  })

  it("send 里再推事件不会掺进正在发的这一批", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((events) => {
      sent.push(events)
      if (sent.length === 1) b.push(tick(99))
    })
    b.push(tick(1))
    vi.advanceTimersByTime(16)
    expect(sent[0]?.map((e) => e.at)).toEqual([1])
    vi.advanceTimersByTime(16)
    expect(sent[1]?.map((e) => e.at)).toEqual([99])
  })

  it("发完一批之后新的事件重新开窗口", () => {
    const sent: (readonly Event[])[] = []
    const b = createBatcher((e) => sent.push(e))
    b.push(tick(1))
    vi.advanceTimersByTime(16)
    b.push(tick(2))
    vi.advanceTimersByTime(16)
    expect(sent).toHaveLength(2)
  })
})
