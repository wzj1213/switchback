import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
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

describe("改名归约", () => {
  const born: Event = {
    type: "thread.started",
    at: 0,
    thread: { id: "t", title: "老名字", cwd: "/w", engine: "claude", trust: "auto-edit", status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["claude"] },
  }

  it("换掉标题", () => {
    const s = reduceAll(initial(), [born, { type: "thread.renamed", at: 1, threadId: "t", title: "新名字" }])
    expect(s.threads["t"]?.title).toBe("新名字")
  })

  it("**不认识的 id 直接忽略**——凭空造一个只有标题的会话比丢掉这次改名糟得多", () => {
    const s = reduceAll(initial(), [{ type: "thread.renamed", at: 1, threadId: "查无此人", title: "x" }])
    expect(s.threads["查无此人"]).toBeUndefined()
    expect(s.order).toEqual([])
  })
})

describe("批量归约的可变累加器不能污染传入的状态", () => {
  const born = (id: string): Event => ({
    type: "thread.started",
    at: 0,
    thread: { id, title: id, cwd: "/w", engine: "claude", trust: "auto-edit", status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["claude"] },
  })
  const turn = (id: string, threadId: string): Event => ({
    type: "turn.started",
    at: 0,
    turn: { id, threadId, engine: "claude", status: "running", startedAt: 0 },
  })
  const item = (id: string, turnId: string): Event => ({
    type: "item.started",
    at: 0,
    item: { id, kind: "agent_message", turnId, at: 0, text: "x", complete: true },
  })

  it("**传进去的 state 一个字段都不能被改**——这是 transient 手法安全的前提", () => {
    const before = reduceAll(initial(), [born("t"), turn("r", "t"), item("a", "r")])
    const snapshot = JSON.stringify(before)
    reduceAll(before, [item("b", "r"), item("c", "r")])
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it("批量的结果和逐条一模一样", () => {
    const events = [born("t"), turn("r", "t"), item("a", "r"), item("b", "r"), item("c", "r")]
    const 逐条 = events.reduce((s, e) => reduceAll(s, [e]), initial())
    const 成批 = reduceAll(initial(), events)
    expect(成批.owner).toEqual(逐条.owner)
    expect(itemsOf(成批, "t").map((i) => i.id)).toEqual(itemsOf(逐条, "t").map((i) => i.id))
  })

  it("批量之后 owner 仍然能定位到 item（`item.updated` 靠它找宿主会话）", () => {
    const s = reduceAll(initial(), [born("t"), turn("r", "t"), item("a", "r"), item("b", "r")])
    const patched = reduceAll(s, [
      { type: "item.updated", at: 1, item: { id: "a", kind: "agent_message", turnId: "r", at: 1, text: "改过了", complete: true } },
      { type: "item.updated", at: 1, item: { id: "b", kind: "agent_message", turnId: "r", at: 1, text: "也改过", complete: true } },
    ])
    expect(itemsOf(patched, "t").map((i) => ("text" in i ? i.text : ""))).toEqual(["改过了", "也改过"])
  })
})
