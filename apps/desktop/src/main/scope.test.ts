import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { REMOTE_THREAD_CHARS, bodyOf, headerOf, scopeReplay, withCurrent } from "./scope.js"
import type { ThreadHistory } from "./host.js"

const msg = (id: string, text = "hi"): Item => ({ id, turnId: "u", kind: "user_message", at: 0, text })

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

/**
 * 一条大约 `bytes` 字节的会话，摊成很多条**正常大小**的事件。
 *
 * 真机上那两条就是这个形状：1549 条事件、2.5 MB，平均一条 1.6 KB
 *（工具输出撑的）。**不是一条巨大的事件**——那种会被 `bodyOf` 整条丢掉，
 * 演不出「条数看着小、字节大两个数量级」这件事。
 */
const fat = (id: string, bytes: number): ThreadHistory => {
  const per = 1600
  const n = Math.max(1, Math.round(bytes / per))
  return {
    id,
    events: [
      { type: "thread.started", at: 0, thread: record(id) },
      ...Array.from({ length: n }, (_, i): Event => ({
        type: "item.started",
        at: i,
        item: msg(`${id}-${String(i)}`, "x".repeat(per - 120)),
      })),
    ],
  }
}

const sizeOf = (t: { events: readonly Event[] }): number =>
  t.events.reduce((n, e) => n + JSON.stringify(e).length, 0)

describe("按大小挑哪些会话带正文", () => {
  it("不给预算 = 全带（桌面窗口那条路，同机 IPC 不心疼）", () => {
    const scoped = scopeReplay([fat("a", 9_000_000), fat("b", 9_000_000)])
    expect(scoped.bodies.size).toBe(2)
    expect(scoped.deferred).toBe(0)
  })

  it("装得下就都带", () => {
    const scoped = scopeReplay([fat("a", 100), fat("b", 100)], 100_000)
    expect([...scoped.bodies]).toEqual(["a", "b"])
    expect(scoped.deferred).toBe(0)
  })

  it("**判据是大小不是条数**——真机上就是栽在这里：九条会话才 3291 条事件，合起来 5.2 MB", () => {
    // 两条「事件不多但很大」的会话：按条数算怎么都装得下，按大小算装不下。
    // 单条封顶之后各占 REMOTE_THREAD_CHARS，两条就超过下面这个预算
    const scoped = scopeReplay([fat("巨", 300_000), fat("也巨", 300_000)], REMOTE_THREAD_CHARS + 1000)
    expect([...scoped.bodies]).toEqual(["巨"])
    expect(scoped.deferred).toBe(1)
  })

  it("**最近写过的优先**——`journal.list()` 本来就是这个顺序，人回头找的也是刚才那条", () => {
    const scoped = scopeReplay([fat("最近", 60_000), fat("上周", 60_000), fat("上个月", 60_000)], 70_000)
    expect([...scoped.bodies]).toEqual(["最近"])
    expect(scoped.deferred).toBe(2)
  })

  it("**第一条永远带正文**——打开看到空白是这一端最没用的状态", () => {
    const scoped = scopeReplay([fat("巨大", 5_000_000), fat("小的", 10)], 1000)
    expect(scoped.bodies.has("巨大")).toBe(true)
  })

  it("**但第一条也封了顶**——否则一条 2.5 MB 的会话就能把整份预算架空", () => {
    const scoped = scopeReplay([fat("巨大", 5_000_000)], 1_000_000)
    expect(scoped.trimmed).toBe(1)
  })

  it("一条会话都没有时不报错", () => {
    expect(scopeReplay([], 100_000)).toEqual({ bodies: new Set(), deferred: 0, trimmed: 0 })
  })
})

describe("单条正文封顶：丢开头留尾巴", () => {
  const many = (id: string, n: number): ThreadHistory => ({
    id,
    events: [
      { type: "thread.started", at: 0, thread: record(id) },
      ...Array.from({ length: n }, (_, i): Event => ({ type: "item.started", at: i, item: msg(`${id}-${String(i)}`) })),
    ],
  })

  it("装得下就原样不动", () => {
    const out = bodyOf(many("a", 3), 100_000)
    expect(out.trimmed).toBe(false)
    expect(out.events).toHaveLength(4)
  })

  it("**留的是尾巴不是开头**——你回头找的是刚才那几句，不是三小时前那句", () => {
    const out = bodyOf(many("a", 200), 2000)
    expect(out.trimmed).toBe(true)
    const ids = out.events.filter((e) => e.type === "item.started").map((e) => e.item.id)
    expect(ids.at(-1)).toBe("a-199")
    expect(ids).not.toContain("a-0")
  })

  it("**头一条不丢**——丢了这条会话在归约器里就无处安放", () => {
    const out = bodyOf(many("a", 200), 10)
    expect(out.events[0]).toMatchObject({ type: "thread.started" })
    expect(sizeOf(out)).toBeGreaterThan(0)
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

describe("补正文时用当前状态收口", () => {
  it("**活着的会话补它现在那份记录**——磁盘上那份可能停在轮次中间", () => {
    const live = { ...record("a"), title: "现在的名字", status: "running" as const }
    const out = withCurrent(thread("a", 2).events, live, 99)
    expect(out.at(-1)).toEqual({ type: "thread.updated", at: 99, thread: live })
  })

  it("**背后没有引擎进程的补 detached**——能打字却答非所问的输入框比没有更糟", () => {
    const out = withCurrent(thread("a", 2).events, undefined, 99)
    expect(out.at(-1)).toMatchObject({ type: "thread.updated", thread: { detached: true, status: "idle" } })
  })

  it("空历史不收口——那会凭空造出一条会话", () => {
    expect(withCurrent([], undefined, 99)).toEqual([])
  })

  it("记录里没有 thread 事件时也不硬造一条", () => {
    const events: Event[] = [{ type: "item.started", at: 0, item: msg("i") }]
    expect(withCurrent(events, undefined, 99)).toEqual(events)
  })
})
