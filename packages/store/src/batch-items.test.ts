import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@switchback/protocol"
import { initial, type ViewState } from "./state.js"
import { reduce, reduceAll, reduceHistory } from "./reduce.js"

const thread = (id: string): Thread => ({
  id, title: id, cwd: "/w", engine: "codex", trust: "auto-edit", status: "idle",
  createdAt: 0, updatedAt: 0, engineHistory: ["codex"],
})
const open = (id: string): Event[] => [
  { type: "thread.started", at: 0, thread: thread(id) },
  { type: "turn.started", at: 0, turn: { id: `u-${id}`, threadId: id, engine: "codex", status: "running", startedAt: 0 } },
]
const message = (id: string, who = "a"): Item => ({
  id, turnId: `u-${who}`, kind: "agent_message", at: 0, text: id, complete: false,
})
const add = (id: string, who = "a"): Event => ({ type: "item.started", at: 0, item: message(id, who) })
const delta = (id: string): Event => ({ type: "item.delta", at: 0, itemId: id, append: "+" })
const remove = (id: string): Event => ({ type: "item.removed", at: 0, turnId: "u-a", itemId: id })

/** 深冻结输入能直接抓到批量缓存污染 React 上一帧的错误。 */
function freeze(state: ViewState): ViewState {
  for (const items of Object.values(state.items)) {
    items.forEach(Object.freeze)
    Object.freeze(items)
  }
  Object.values(state).forEach(Object.freeze)
  return Object.freeze(state)
}

describe("批量消息累加器", () => {
  const cases: { name: string; events: Event[] }[] = [
    { name: "跨会话交错追加和更新", events: [add("x"), add("y", "b"), delta("first"), delta("y")] },
    { name: "磁盘与增量重叠时原位替换", events: [add("x"), delta("x"), add("first"), add("x"), delta("x")] },
    { name: "删除中间项后的位置不串", events: [add("x"), add("y"), remove("x"), delta("y"), add("z"), delta("z")] },
    { name: "删除再追加同 id", events: [remove("first"), delta("first"), add("first"), delta("first")] },
    { name: "整项更新后继续流式追加", events: [add("x"), { type: "item.updated", at: 0, item: message("first") }, delta("first")] },
    { name: "删会话后不得复活索引", events: [add("x"), { type: "thread.removed", at: 0, threadId: "a" }, add("y", "b"), delta("x")] },
    { name: "删除后重建同名会话", events: [add("x"), { type: "thread.removed", at: 0, threadId: "a" }, ...open("a"), add("new"), delta("new")] },
    { name: "未知消息保持幂等", events: [delta("unknown"), remove("unknown"), add("x"), delta("unknown")] },
  ]
  for (const { name, events } of cases) {
    it(name, () => {
      const before = freeze(reduceAll(initial(), [...open("a"), ...open("b"), add("first")]))
      const expected = events.reduce((state, event) => reduce(state, event), before)
      const after = reduceAll(before, events)
      expect(after).toEqual(expected)
      expect(before.items["a"]).toEqual([message("first")])
      expect(reduceAll(before, events)).toEqual(after)
    })
  }

  it("下一批追加不会改变上一批结果，没动的会话保留引用", () => {
    const first = freeze(reduceAll(initial(), [...open("a"), ...open("b"), add("first"), add("b", "b")]))
    const second = freeze(reduceAll(first, [add("x"), delta("x")]))
    const third = reduceAll(second, [add("y"), delta("first")])
    expect(first.items["a"]).toHaveLength(1)
    expect(second.items["a"]).toHaveLength(2)
    expect(third.items["a"]).toHaveLength(3)
    expect(third.items["b"]).toBe(first.items["b"])
  })

  it("单独补历史的替换语义和其他会话保持不变", () => {
    const before = freeze(reduceAll(initial(), [...open("a"), ...open("b"), add("first"), add("b", "b")]))
    const after = reduceHistory(before, "a", [add("old"), add("new"), delta("old")])
    expect(after.items["a"]?.map((item) => item.id)).toEqual(["old", "new"])
    expect(after.owner["first"]).toBeUndefined()
    expect(after.items["b"]).toBe(before.items["b"])
  })
})
