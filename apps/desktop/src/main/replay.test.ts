import { describe, expect, it } from "vitest"
import type { Thread, ThreadId } from "@omni/protocol"
import { initial, reduceAll, threadRowsOf } from "@omni/store"
import { replayEvents, type ThreadHistory } from "./host.js"

const thread = (id: string, title: string): Thread => ({
  id,
  cwd: `/w/${id}`,
  engine: "codex",
  trust: "auto-edit",
  title,
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
})

/** 带一条用户消息——`rebuild` 只留说过话的会话，见下面那组用例。 */
const history = (id: string, title: string): ThreadHistory => ({
  id,
  events: [
    { type: "thread.started", at: 0, thread: thread(id, title) },
    {
      type: "item.started",
      at: 1,
      item: { id: `${id}-u`, turnId: "t", at: 1, kind: "user_message", text: "说了一句" },
    },
  ],
})

/** 只开了个头，一个字没说。 */
const emptyHistory = (id: string, title: string): ThreadHistory => ({
  id,
  events: [{ type: "thread.started", at: 0, thread: thread(id, title) }],
})

/** journal.list 给的是**最近写过的在前**。 */
const NEWEST_FIRST: readonly ThreadHistory[] = [
  history("t3", "最新"),
  history("t2", "中间"),
  history("t1", "最旧"),
]

const none = new Map<ThreadId, Thread>()

describe("全量重建", () => {
  it("引擎清单排在最前——界面要靠它渲染选择器", () => {
    const events = replayEvents([{ id: "codex", label: "Codex" }], [], none, 1)
    expect(events[0]).toMatchObject({ type: "engines.available" })
  })

  it("**跑一遍归约器，侧栏顺序必须是最新在前**——这才是真正要保证的东西", () => {
    const state = reduceAll(initial(), replayEvents([], NEWEST_FIRST, none, 1))
    expect(threadRowsOf(state).map((r) => r.thread.title)).toEqual(["最新", "中间", "最旧"])
  })

  it("空历史的会话跳过，不留一条只有 id 的空行", () => {
    const events = replayEvents([], [{ id: "empty", events: [] }], none, 1)
    expect(events).toHaveLength(1)
  })
})

describe("活着的和历史要分开", () => {
  it("**活着的会话不标 detached**——标了的话重载之后整个应用变成只读，而引擎还在跑", () => {
    const alive = new Map<ThreadId, Thread>([["t2", { ...thread("t2", "中间"), status: "running" }]])
    const state = reduceAll(initial(), replayEvents([], NEWEST_FIRST, alive, 1))
    const rows = threadRowsOf(state)
    expect(rows.find((r) => r.thread.id === "t2")?.thread.detached).toBeUndefined()
    expect(rows.find((r) => r.thread.id === "t2")?.thread.status).toBe("running")
  })

  it("没有引擎进程的一律标 detached，输入框关掉", () => {
    const state = reduceAll(initial(), replayEvents([], NEWEST_FIRST, none, 1))
    for (const row of threadRowsOf(state)) expect(row.thread.detached).toBe(true)
  })

  it("活着的那份用宿主手上的当前状态收尾——journal 最后一条可能停在轮次中间", () => {
    const running: Thread = { ...thread("t1", "改过名了"), status: "running" }
    const alive = new Map<ThreadId, Thread>([["t1", running]])
    const state = reduceAll(initial(), replayEvents([], [history("t1", "旧名字")], alive, 1))
    expect(threadRowsOf(state)[0]?.thread.title).toBe("改过名了")
  })
})

describe("空壳会话不进侧栏", () => {
  it("**一句话都没说过的不算历史**——omni 每次启动都开一个默认会话，不滤掉的话跑一周侧栏全是空壳", () => {
    const state = reduceAll(initial(), replayEvents([], [emptyHistory("空", "空")], none, 1))
    expect(threadRowsOf(state)).toEqual([])
  })

  it("说过话的照常留着", () => {
    const state = reduceAll(initial(), replayEvents([], [history("有话", "有话")], none, 1))
    expect(threadRowsOf(state)).toHaveLength(1)
  })

  it("**活着的空会话是例外**——它正开着，用户随时会在里面打字", () => {
    const alive = new Map<ThreadId, Thread>([["空", thread("空", "空")]])
    const state = reduceAll(initial(), replayEvents([], [emptyHistory("空", "空")], alive, 1))
    expect(threadRowsOf(state)).toHaveLength(1)
  })
})
