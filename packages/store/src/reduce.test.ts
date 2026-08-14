import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { initial, itemsOf, threadsOf } from "./state.js"
import { reduce, reduceAll } from "./reduce.js"

const thread = (id: string): Thread => ({
  id,
  title: id,
  cwd: "/w",
  engine: "claude",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["claude"],
})

const started = (id: string): Event => ({ type: "thread.started", at: 0, thread: thread(id) })

const turnStarted = (threadId: string, turnId: string): Event => ({
  type: "turn.started",
  at: 0,
  turn: { id: turnId, threadId, engine: "claude", status: "running", startedAt: 0 },
})

const msg = (id: string, turnId: string, text: string): Item => ({
  id,
  turnId,
  kind: "agent_message",
  at: 0,
  text,
  complete: false,
})

describe("reduce", () => {
  it("新会话进表且排在最前", () => {
    const s = reduceAll(initial(), [started("a"), started("b")])
    expect(threadsOf(s).map((t) => t.id)).toEqual(["b", "a"])
  })

  it("同一会话再次上报不会重复进顺序表", () => {
    const s = reduceAll(initial(), [started("a"), started("a")])
    expect(s.order).toEqual(["a"])
  })

  it("item 通过 turn 归属到会话", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "hi") },
    ])
    expect(itemsOf(s, "a")).toHaveLength(1)
  })

  it("轮次未知的 item 被丢弃，而不是崩掉", () => {
    const s = reduce(initial(), { type: "item.started", at: 0, item: msg("i1", "ghost", "x") })
    expect(s).toEqual(initial())
  })

  it("delta 追加到流式文本上", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "he") },
      { type: "item.delta", at: 0, itemId: "i1", append: "llo" },
    ])
    const first = itemsOf(s, "a")[0]
    expect(first?.kind === "agent_message" ? first.text : "").toBe("hello")
  })

  it("delta 打到非文本 item 上不改变它", () => {
    const tool: Item = {
      id: "i2",
      turnId: "t1",
      kind: "tool_call",
      at: 0,
      tool: "Bash",
      status: "running",
      detail: { kind: "shell", command: "ls" },
    }
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: tool },
      { type: "item.delta", at: 0, itemId: "i2", append: "ignored" },
    ])
    expect(itemsOf(s, "a")[0]).toEqual(tool)
  })

  it("turn.completed 清掉当前轮次", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "turn.completed", at: 0, turnId: "t1", status: "completed" },
    ])
    expect(s.turns["a"]).toBeUndefined()
  })

  it("认不出的事件原样返回旧状态", () => {
    const before = reduceAll(initial(), [started("a")])
    const after = reduce(before, { type: "engine.status", at: 0, threadId: "a", status: "ready" })
    expect(after).toBe(before)
  })

  it("归约是不可变的——旧状态不被改写", () => {
    const before = reduceAll(initial(), [started("a")])
    reduce(before, started("b"))
    expect(before.order).toEqual(["a"])
  })
})
