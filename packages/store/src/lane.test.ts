import { describe, expect, it } from "vitest"
import type { Event, Item, Lane } from "@switchback/protocol"
import { initial } from "./state.js"
import { lanesOf, laneItems, mainItems } from "./state.js"
import { reduce } from "./reduce.js"

const lane = (id: string, patch: Partial<Lane> = {}): Lane => ({
  id, threadId: "th-1", kind: "activity", title: id, status: "running", at: 0, ...patch,
})
const item = (id: string, laneId?: string): Item => ({
  id, turnId: "tu-1", at: 0, kind: "agent_message", text: id, complete: true,
  ...(laneId === undefined ? {} : { lane: { id: laneId } }),
})
const run = (events: readonly Event[]) => events.reduce((s, e) => reduce(s, e), initial())
const born: Event[] = [
  { type: "thread.started", at: 0, thread: {
    id: "th-1", title: "t", cwd: "/w", engine: "fake", trust: "auto-edit",
    status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["fake"] } },
  { type: "turn.started", at: 0, turn: { id: "tu-1", threadId: "th-1", engine: "fake", status: "running", startedAt: 0 } },
]

describe("旁路进 store", () => {
  it("**upsert，同 id 整条替换**——没有「起」和「改」两条事件，这里也只有一个分支", () => {
    const s = run([...born,
      { type: "lane.updated", at: 0, threadId: "th-1", lane: lane("w1") },
      { type: "lane.updated", at: 1, threadId: "th-1", lane: lane("w1", { status: "done", title: "改过了" }) },
    ])
    expect(lanesOf(s, "th-1")).toHaveLength(1)
    expect(lanesOf(s, "th-1")[0]).toMatchObject({ status: "done", title: "改过了" })
  })

  it("新的追加在末尾——标签按「先开的在左边」排，重排会让它们在跑的过程中跳位置", () => {
    const s = run([...born,
      { type: "lane.updated", at: 0, threadId: "th-1", lane: lane("a") },
      { type: "lane.updated", at: 1, threadId: "th-1", lane: lane("b") },
      { type: "lane.updated", at: 2, threadId: "th-1", lane: lane("a", { status: "done" }) },
    ])
    expect(lanesOf(s, "th-1").map((l) => l.id)).toEqual(["a", "b"])
  })

  it("**删会话要一起清**——漏了就是内存泄漏，lane 里可能挂着一整棵 30 节点的树", () => {
    const s = run([...born,
      { type: "lane.updated", at: 0, threadId: "th-1", lane: lane("w1", {
        progress: { nodes: [{ id: "a1", label: "x", state: "running" }] } }) },
      { type: "thread.removed", at: 1, threadId: "th-1" },
    ])
    expect(s.lanes["th-1"]).toBeUndefined()
  })

  it("分流：带 lane 的不进主线，主线的不进旁路", () => {
    const s = run([...born,
      { type: "item.started", at: 0, item: item("i1") },
      { type: "item.started", at: 1, item: item("i2", "w1") },
      { type: "item.started", at: 2, item: item("i3", "w2") },
    ])
    expect(mainItems(s, "th-1").map((i) => i.id)).toEqual(["i1"])
    expect(laneItems(s, "th-1", "w1").map((i) => i.id)).toEqual(["i2"])
  })

  it("**老记录一条都没有 `lane`，全落主线**——回放不需要迁移", () => {
    const s = run([...born, { type: "item.started", at: 0, item: item("i1") }, { type: "item.started", at: 1, item: item("i2") }])
    expect(mainItems(s, "th-1")).toHaveLength(2)
    // 一条都不带 lane 时**原样返回**，不新造数组——`Transcript` 的 memo 认引用
    expect(mainItems(s, "th-1")).toBe(s.items["th-1"])
  })

  it("认不出的会话上取旁路给空数组，调用方不用判空", () => {
    expect(lanesOf(initial(), "th-gone")).toEqual([])
  })
})
