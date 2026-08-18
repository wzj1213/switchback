import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { headerOf, scopeReplay } from "./scope.js"
import type { ThreadHistory } from "./host.js"

const msg = (id: string): Item => ({ id, turnId: "u", kind: "user_message", at: 0, text: "hi" })

const record = (id: string, title = id): Thread => ({
  id,
  title,
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
})

const thread = (id: string, items: number): ThreadHistory => ({
  id,
  events: [
    { type: "thread.started", at: 0, thread: record(id) },
    ...Array.from({ length: items }, (_, i): Event => ({ type: "item.started", at: i, item: msg(`${id}-${String(i)}`) })),
  ],
})

describe("按预算挑哪些会话带正文", () => {
  it("不给预算 = 全带（桌面窗口那条路，同机 IPC 不心疼）", () => {
    const scoped = scopeReplay([thread("a", 100), thread("b", 100)])
    expect(scoped.bodies.size).toBe(2)
    expect(scoped.deferred).toBe(0)
  })

  it("装得下就都带", () => {
    const scoped = scopeReplay([thread("a", 5), thread("b", 5)], 100)
    expect([...scoped.bodies]).toEqual(["a", "b"])
    expect(scoped.deferred).toBe(0)
  })

  it("**最近写过的优先**——`journal.list()` 本来就是这个顺序，人回头找的也是刚才那条", () => {
    const scoped = scopeReplay([thread("最近", 50), thread("上周", 50), thread("上个月", 50)], 60)
    expect([...scoped.bodies]).toEqual(["最近"])
    expect(scoped.deferred).toBe(2)
  })

  it("**第一条永远带正文，哪怕它自己就超预算**——打开看到空白是这一端最没用的状态", () => {
    const scoped = scopeReplay([thread("巨大", 9999), thread("小的", 1)], 10)
    expect(scoped.bodies.has("巨大")).toBe(true)
    expect(scoped.bodies.has("小的")).toBe(false)
  })

  it("超预算的那条之后，装得下的还能接着装——判据是逐条累加不是一刀切", () => {
    const scoped = scopeReplay([thread("a", 5), thread("巨大", 999), thread("c", 5)], 20)
    expect([...scoped.bodies]).toEqual(["a", "c"])
    expect(scoped.deferred).toBe(1)
  })

  it("一条会话都没有时不报错", () => {
    expect(scopeReplay([], 100)).toEqual({ bodies: new Set(), deferred: 0 })
  })
})

describe("只发头", () => {
  it("取最后那一条 thread 事件——列表要靠它画标题、状态、引擎", () => {
    const events: Event[] = [
      ...thread("a", 3).events,
      { type: "thread.updated", at: 9, thread: record("a", "改过名") },
    ]
    const header = headerOf({ id: "a", events })
    expect(header).toHaveLength(1)
    expect(header[0]).toMatchObject({ type: "thread.updated", thread: { title: "改过名" } })
  })

  it("**基底之后的改名要跟着走**——只发基底的话，手机上显示的是旧标题", () => {
    const events: Event[] = [
      ...thread("a", 3).events,
      { type: "thread.renamed", at: 9, threadId: "a", title: "改过名" },
    ]
    const header = headerOf({ id: "a", events })
    expect(header.map((e) => e.type)).toEqual(["thread.started", "thread.renamed"])
  })

  it("基底**之前**的改名不带——那一份已经被基底那张快照吸收了", () => {
    const events: Event[] = [
      { type: "thread.renamed", at: 0, threadId: "a", title: "更早的名字" },
      ...thread("a", 1).events,
    ]
    expect(headerOf({ id: "a", events }).map((e) => e.type)).toEqual(["thread.started"])
  })

  it("**记录里没有 thread 事件就什么都不发**——一行没有名字的空壳比不出现更糟", () => {
    expect(headerOf({ id: "a", events: [{ type: "item.started", at: 0, item: msg("i") }] })).toEqual([])
  })
})
