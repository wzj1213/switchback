import { describe, expect, it } from "vitest"
import type { Event, Item, Thread, ToolCallItem } from "@omni/protocol"
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
    // shell 的输出现在**是**流式的（见下方「shell 输出的实时增量」），
    // 所以这条用一个不吃增量的形态来守「认不出就原样返回」这条规则
    const tool: Item = {
      id: "i2",
      turnId: "t1",
      kind: "tool_call",
      at: 0,
      tool: "Read",
      status: "running",
      detail: { kind: "file_read", path: "/w/a.ts" },
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

describe("shell 输出的实时增量", () => {
  const call = (output?: string): ToolCallItem => ({
    id: "e1",
    turnId: "tn1",
    kind: "tool_call",
    at: 0,
    tool: "shell",
    status: "running",
    detail: { kind: "shell", command: "pnpm build", ...(output === undefined ? {} : { output }) },
  })

  const seeded = (): ReturnType<typeof initial> =>
    reduceAll(initial(), [
      started("t1"),
      turnStarted("t1", "tn1"),
      { type: "item.started", at: 0, item: call() },
    ])

  const outputOf = (state: ReturnType<typeof initial>): string => {
    const item = itemsOf(state, "t1")[0]
    if (item?.kind !== "tool_call" || item.detail.kind !== "shell") return ""
    return item.detail.output ?? ""
  }

  it("追加到 shell 的 output——命令跑着时看得到滚动，全靠这条", () => {
    const next = reduceAll(seeded(), [
      { type: "item.delta", at: 1, itemId: "e1", append: "line 1\n" },
      { type: "item.delta", at: 2, itemId: "e1", append: "line 2\n" },
    ])
    expect(outputOf(next)).toBe("line 1\nline 2\n")
  })

  it("留尾不留头：超过上限只保留最近的输出", () => {
    const next = reduceAll(seeded(), [
      { type: "item.delta", at: 1, itemId: "e1", append: "旧".repeat(9000) },
      { type: "item.delta", at: 2, itemId: "e1", append: "新" },
    ])
    const out = outputOf(next)
    expect(out).toHaveLength(8000)
    expect(out.endsWith("新")).toBe(true)
  })

  it("收工时整条替换，不会把流过的输出再拼一遍", () => {
    const streamed = reduceAll(seeded(), [{ type: "item.delta", at: 1, itemId: "e1", append: "line 1\n" }])
    const done = reduce(streamed, {
      type: "item.updated",
      at: 2,
      item: { ...call("line 1\n"), status: "ok" },
    })
    expect(outputOf(done)).toBe("line 1\n")
  })

  it("非 shell 的工具调用不吃增量——diff 不是流式的", () => {
    const state = reduceAll(initial(), [
      started("t1"),
      turnStarted("t1", "tn1"),
      {
        type: "item.started",
        at: 0,
        item: {
          id: "f1",
          turnId: "tn1",
          kind: "tool_call",
          at: 0,
          tool: "apply_patch",
          status: "running",
          detail: { kind: "file_edit", path: "/w/a.ts", files: [], added: 0, removed: 0 },
        },
      },
      { type: "item.delta", at: 1, itemId: "f1", append: "x" },
    ])
    expect(itemsOf(state, "t1")[0]).toMatchObject({ detail: { kind: "file_edit", path: "/w/a.ts" } })
  })
})
