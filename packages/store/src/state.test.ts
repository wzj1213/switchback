import { describe, expect, it } from "vitest"
import type { Thread } from "@omni/protocol"
import { foreignByEngine, forkPeerOf, initial, threadRowsOf, type ViewState } from "./state.js"
import { reduceAll } from "./reduce.js"

const thread = (id: string, at: number, forkedFrom?: string): Thread => ({
  id,
  title: id,
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: at,
  updatedAt: at,
  engineHistory: ["codex"],
  ...(forkedFrom === undefined ? {} : { forkedFrom }),
})

const stateWith = (...threads: Thread[]): ViewState =>
  reduceAll(
    initial(),
    threads.map((t) => ({ type: "thread.started" as const, at: t.createdAt, thread: t })),
  )

describe("找分叉对手", () => {
  it("我分叉出来的，算", () => {
    const state = stateWith(thread("父", 1), thread("子", 2, "父"))
    expect(forkPeerOf(state, "父")?.id).toBe("子")
  })

  it("把我分叉出来的，也算——**关系是双向的**，从哪边点「对比」都该有反应", () => {
    const state = stateWith(thread("父", 1), thread("子", 2, "父"))
    expect(forkPeerOf(state, "子")?.id).toBe("父")
  })

  it("同源的兄弟，算", () => {
    const state = stateWith(thread("父", 1), thread("子1", 2, "父"), thread("子2", 3, "父"))
    expect(forkPeerOf(state, "子1")?.id).toBe("子2")
  })

  it("没有血缘就返回 undefined——界面据此不显示按钮，**点了没用的按钮比没有糟**", () => {
    const state = stateWith(thread("独一份", 1), thread("无关的", 2))
    expect(forkPeerOf(state, "独一份")).toBeUndefined()
  })

  it("多个候选取最近创建的", () => {
    const state = stateWith(thread("父", 1), thread("旧子", 2, "父"), thread("新子", 5, "父"))
    expect(forkPeerOf(state, "父")?.id).toBe("新子")
  })

  it("会话不存在时不炸", () => {
    expect(forkPeerOf(initial(), "查无此人")).toBeUndefined()
  })

  it("自己不是自己的对手", () => {
    const state = stateWith(thread("独苗", 1))
    expect(forkPeerOf(state, "独苗")).toBeUndefined()
  })
})

describe("侧栏行", () => {
  it("最近创建的在前——归约器往前插，这是它的直接后果", () => {
    const state = stateWith(thread("先", 1), thread("后", 2))
    expect(threadRowsOf(state).map((r) => r.thread.id)).toEqual(["后", "先"])
  })
})

describe("历史段：装了的每一家各一段", () => {
  const withEngines = (engines: { id: string; state?: "ok" | "missing" }[], threads = {}): ViewState => ({
    ...initial(),
    engines: engines.map((e) => ({ label: e.id, ...e })) as ViewState["engines"],
    engineThreads: threads,
  })

  it("**没报过历史的也给段头**——「这里能放什么」正是还没用过的人最需要知道的", () => {
    const got = foreignByEngine(withEngines([{ id: "codex" }, { id: "claude" }]))
    expect(got.map((g) => g.engine)).toEqual(["codex", "claude"])
    expect(got.every((g) => g.threads.length === 0)).toBe(true)
  })

  it("没装的那家不给段——摆一段永远空的出来只是噪声", () => {
    const got = foreignByEngine(withEngines([{ id: "codex" }, { id: "kimi", state: "missing" }]))
    expect(got.map((g) => g.engine)).toEqual(["codex"])
  })

  it("顺序跟着引擎清单走，**不按条数排**：位置每次都变的话肌肉记忆就废了", () => {
    const many = { claude: [{ handle: "a", title: "x", cwd: "/w", updatedAt: 1 }] }
    const got = foreignByEngine(withEngines([{ id: "codex" }, { id: "claude" }], many))
    expect(got.map((g) => g.engine)).toEqual(["codex", "claude"])
  })

  it("报过历史但清单里还没有的也带上——清单迟到时不该让已有的一段闪一下才出现", () => {
    const got = foreignByEngine(withEngines([], { codex: [{ handle: "a", title: "x", cwd: "/w", updatedAt: 1 }] }))
    expect(got.map((g) => g.engine)).toEqual(["codex"])
  })
})
