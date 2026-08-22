import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@omni/protocol"
import {
  baseNameOf,
  commandsOf,
  foreignByEngine,
  forkPeerOf,
  initial,
  modelsOf,
  projectsOf,
  threadRowsOf,
  usageOf,
  type ViewState,
} from "./state.js"
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

/**
 * 模型清单要认「是谁报的」。
 *
 * 一条会话中途会换引擎，而模型 id 是各家私有的。切过去之后新那家的清单是
 * 异步才到的、而且完全可能一个都报不上来（`models()` 失败就是空数组，
 * 那时宿主什么都不发）——只按会话 id 取的话，那段时间界面上摆的是**上一家的模型**。
 */
describe("模型清单认引擎", () => {
  const withModels = (engine: string): ViewState =>
    reduceAll(initial(), [
      { type: "models.updated", at: 1, threadId: "th-1", engine, models: [{ id: "m1", label: "M1" }] },
    ])

  it("是这家报的就给", () => {
    expect(modelsOf(withModels("codex"), "th-1", "codex")).toEqual([{ id: "m1", label: "M1" }])
  })

  it("**换了一家就当没有**——宁可什么都不摆，也不摆一份点了会出错的", () => {
    expect(modelsOf(withModels("codex"), "th-1", "claude")).toEqual([])
  })

  it("没报过就是空的", () => {
    expect(modelsOf(initial(), "th-1", "codex")).toEqual([])
  })

  it("新引擎上报后仍保留旧引擎那份，失败回滚可直接恢复", () => {
    const switched = reduceAll(withModels("codex"), [
      { type: "models.updated", at: 2, threadId: "th-1", engine: "claude", models: [] },
    ])
    expect(modelsOf(switched, "th-1", "codex")).toEqual([{ id: "m1", label: "M1" }])
  })
})

describe("斜杠命令清单认引擎", () => {
  const state = reduceAll(initial(), [{
    type: "commands.updated",
    at: 1,
    threadId: "th-1",
    engine: "codex",
    commands: [{ name: "review", description: "", source: "engine" }],
  }])

  it("只把当前引擎自己报的命令交给输入框", () => {
    expect(commandsOf(state, "th-1", "codex")).toHaveLength(1)
    expect(commandsOf(state, "th-1", "claude")).toEqual([])
  })

  it("另一家清空自己的目录不会抹掉旧引擎目录", () => {
    const switched = reduceAll(state, [
      { type: "commands.updated", at: 2, threadId: "th-1", engine: "claude", commands: [] },
    ])
    expect(commandsOf(switched, "th-1", "codex")).toHaveLength(1)
  })
})

describe("上下文用量认引擎", () => {
  const state = reduceAll(initial(), [{
    type: "usage.updated",
    at: 1,
    threadId: "th-1",
    engine: "codex",
    usage: { contextUsed: 42 },
  }])

  it("接力后不沿用上一家的窗口占用", () => {
    expect(usageOf(state, "th-1", "codex")?.contextUsed).toBe(42)
    expect(usageOf(state, "th-1", "claude")).toBeUndefined()
  })

  it("新引擎用量到达后仍能在回滚时取回旧引擎用量", () => {
    const switched = reduceAll(state, [{
      type: "usage.updated", at: 2, threadId: "th-1", engine: "claude", usage: { contextUsed: 9 },
    }])
    expect(usageOf(switched, "th-1", "codex")?.contextUsed).toBe(42)
  })

  it("新原生会话启动会清掉这家上一条会话的陈旧用量", () => {
    const cleared = reduceAll(state, [
      { type: "usage.cleared", at: 2, threadId: "th-1", engine: "codex" },
    ])
    expect(usageOf(cleared, "th-1", "codex")).toBeUndefined()
  })

  it("旧 journal 没有来源引擎时按当时的 thread 引擎迁移", () => {
    const legacy = {
      type: "usage.updated", at: 1, threadId: "th-1", usage: { contextUsed: 7 },
    } as unknown as Event
    const restored = reduceAll(stateWith(thread("th-1", 0)), [legacy])
    expect(usageOf(restored, "th-1", "codex")?.contextUsed).toBe(7)
  })
})

describe("按项目归堆", () => {
  const at = (id: string, cwd: string, when: number): Thread => ({ ...thread(id, when), cwd })
  const rows = (...list: Thread[]) => threadRowsOf(stateWith(...list))

  it("同一个工作区的会话归到一堆", () => {
    const out = projectsOf(rows(at("a", "/w/omni", 1), at("b", "/w/omni", 2), at("c", "/w/别的", 3)))
    expect(out.map((p) => p.name)).toEqual(["别的", "omni"])
    expect(out.find((p) => p.name === "omni")?.rows).toHaveLength(2)
  })

  it("**组间按各自最新那条排**——你回头找的是「刚才在弄的那个项目」", () => {
    const out = projectsOf(rows(at("旧", "/w/老项目", 1), at("新", "/w/新项目", 99)))
    expect(out.map((p) => p.name)).toEqual(["新项目", "老项目"])
  })

  it("组内沿用传进来的顺序——调用方已经排过一次，这里再排一次只会打架", () => {
    // **直接构造入参**：走 `threadRowsOf` 的话顺序由归约器决定，
    // 那验的就不是这个函数了
    const given = [
      { thread: at("先", "/w/omni", 5), preview: undefined },
      { thread: at("后", "/w/omni", 1), preview: undefined },
    ]
    expect(projectsOf(given)[0]?.rows.map((r) => r.thread.id)).toEqual(["先", "后"])
  })

  it("目录名当项目名；根目录不至于变成空字符串", () => {
    expect(baseNameOf("/Users/you/work/omni")).toBe("omni")
    expect(baseNameOf("/Users/you/work/omni/")).toBe("omni")
    expect(baseNameOf("/")).toBe("/")
  })

  it("**同名不同路径不合并**——两个都叫 web 的目录是两个项目", () => {
    const out = projectsOf(rows(at("a", "/w/一/web", 1), at("b", "/w/二/web", 2)))
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.cwd)).toEqual(["/w/二/web", "/w/一/web"])
  })

  it("一条都没有时给空数组", () => {
    expect(projectsOf([])).toEqual([])
  })
})
