import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { coalesce, reduceAll } from "./reduce.js"
import { initial, itemsOf } from "./state.js"

const d = (itemId: string, append: string, at = 0): Event => ({ type: "item.delta", at, itemId, append })

describe("挨着的 delta 并成一条", () => {
  it("同一条 item 的连续 delta 合并——500 条变 1 条，就少复制 499 次列表", () => {
    expect(coalesce([d("a", "甲"), d("a", "乙"), d("a", "丙")])).toEqual([d("a", "甲乙丙")])
  })

  it("不同 item 不合并", () => {
    expect(coalesce([d("a", "甲"), d("b", "乙")])).toHaveLength(2)
  })

  it("**中间夹了别的事件就断开**——顺序是这套东西唯一的正确性来源", () => {
    const done: Event = {
      type: "item.updated",
      at: 1,
      item: { id: "a", kind: "agent_message", turnId: "r1", at: 0, text: "甲", complete: true },
    }
    const out = coalesce([d("a", "甲"), done, d("a", "乙")])
    expect(out).toHaveLength(3)
  })

  it("时间戳取最后一条：那才是这段文字写完的时刻", () => {
    expect(coalesce([d("a", "甲", 10), d("a", "乙", 20)])[0]).toMatchObject({ at: 20 })
  })

  it("一批 500 条 delta 合成 1 条——归约就少复制 499 遍历史列表", () => {
    const many: Event[] = Array.from({ length: 500 }, (_, i) => d("a", "字", i))
    expect(coalesce(many)).toHaveLength(1)
  })

  it("空数组、单条，原样", () => {
    expect(coalesce([])).toEqual([])
    expect(coalesce([d("a", "甲")])).toEqual([d("a", "甲")])
  })

  it("**和逐条应用结果一模一样**——这是合并的唯一前提", () => {
    const events: Event[] = [
      { type: "thread.started", at: 0, thread: { id: "t", title: "t", cwd: "/w", engine: "claude", trust: "auto-edit", status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["claude"] } },
      { type: "turn.started", at: 0, turn: { id: "r1", threadId: "t", engine: "claude", status: "running", startedAt: 0 } },
      { type: "item.started", at: 0, item: { id: "a", kind: "agent_message", turnId: "r1", at: 0, text: "", complete: false } },
      d("a", "一"), d("a", "二"), d("a", "三"),
    ]
    const 逐条 = events.reduce((s, e) => reduceAll(s, [e]), initial())
    const 成批 = reduceAll(initial(), events)
    expect(itemsOf(成批, "t").map((i) => ("text" in i ? i.text : ""))).toEqual(
      itemsOf(逐条, "t").map((i) => ("text" in i ? i.text : "")),
    )
  })
})
