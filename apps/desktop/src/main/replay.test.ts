import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createJournal } from "@omni/journal"
import type { Event, Thread, ThreadId } from "@omni/protocol"
import { initial, itemsOf, reduceAll, threadRowsOf, turnOf } from "@omni/store"
import type { ThreadHistory } from "./host.js"
import { replayEvents } from "./scope.js"

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
    const events = replayEvents({ engines: [{ id: "codex", label: "Codex" }], threads: [], alive: none, now: 1 })
    expect(events[0]).toMatchObject({ type: "engines.available" })
  })

  it("**跑一遍归约器，侧栏顺序必须是最新在前**——这才是真正要保证的东西", () => {
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: NEWEST_FIRST, alive: none, now: 1 }))
    expect(threadRowsOf(state).map((r) => r.thread.title)).toEqual(["最新", "中间", "最旧"])
  })

  it("空历史的会话跳过，不留一条只有 id 的空行", () => {
    const events = replayEvents({ engines: [], threads: [{ id: "empty", events: [] }], alive: none, now: 1 })
    expect(events).toHaveLength(1)
  })

  it("旧历史里的瞬时横幅不重放，重建之后到达的新提示仍保留", () => {
    const events: Event[] = [
      ...history("t", "历史").events,
      { type: "engine.status", at: 2, threadId: "t", status: "crashed", detail: "旧故障" },
      {
        type: "engine.notification", at: 3, threadId: "t", engine: "claude",
        key: "old", message: "旧提示", priority: "medium",
      },
    ]
    const replayed = replayEvents({ engines: [], threads: [{ id: "t", events }], alive: none, now: 4 })
    const current: Event = {
      type: "engine.notification", at: 5, threadId: "t", engine: "claude",
      key: "new", message: "刚发生", priority: "high",
    }
    const state = reduceAll(initial(), [...replayed, current])
    expect(replayed.some((event) => event.type === "engine.status" || event.type === "engine.notification")).toBe(false)
    expect(state.notices.map((notice) => notice.text)).toEqual(["刚发生"])
  })

  it("无终态快照的监控增量经过真实 journal 后仍能重建", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omni-monitor-replay-"))
    const journal = createJournal({ dir })
    const id = "monitor-replay"
    const turnId = "monitor-turn"
    const monitor: Event[] = [
      { type: "thread.started", at: 0, thread: thread(id, "监控") },
      {
        type: "turn.started", at: 1,
        turn: { id: turnId, threadId: id, engine: "grok", status: "running", startedAt: 1 },
      },
      {
        type: "item.started", at: 2,
        item: { id: "monitor-user", turnId, kind: "user_message", at: 2, text: "开始监控" },
      },
      {
        type: "item.started", at: 3,
        item: { id: "monitor-item", turnId, kind: "tool_call", at: 3, tool: "acp:monitor", status: "running",
          detail: { kind: "shell", command: "Monitor" } },
      },
      { type: "item.delta", at: 4, threadId: id, itemId: "monitor-item", append: "kept after reload\n" },
    ]
    try {
      for (const event of monitor) await journal.append(id, event)
      await journal.flush()
      const saved = await journal.read(id)
      const state = reduceAll(initial(), replayEvents({
        engines: [], threads: [{ id, events: saved }], alive: none, now: 5,
      }))
      const item = itemsOf(state, id).find((one) => one.id === "monitor-item")
      expect(item?.kind === "tool_call" && item.detail.kind === "shell" ? item.detail.output : undefined)
        .toBe("kept after reload\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("活着的和历史要分开", () => {
  it("**活着的会话不标 detached**——标了的话重载之后整个应用变成只读，而引擎还在跑", () => {
    const alive = new Map<ThreadId, Thread>([["t2", { ...thread("t2", "中间"), status: "running" }]])
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: NEWEST_FIRST, alive: alive, now: 1 }))
    const rows = threadRowsOf(state)
    expect(rows.find((r) => r.thread.id === "t2")?.thread.detached).toBeUndefined()
    expect(rows.find((r) => r.thread.id === "t2")?.thread.status).toBe("running")
  })

  it("没有引擎进程的一律标 detached，输入框关掉", () => {
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: NEWEST_FIRST, alive: none, now: 1 }))
    for (const row of threadRowsOf(state)) expect(row.thread.detached).toBe(true)
  })

  it("重建时只更新投影事件时刻，不把所有会话的最后活动时间改成现在", () => {
    const old = { ...thread("t", "上周的会话"), updatedAt: 123 }
    const saved: ThreadHistory = {
      id: "t",
      events: [
        { type: "thread.started", at: 123, thread: old },
        {
          type: "item.started", at: 124,
          item: { id: "u", turnId: "turn", at: 124, kind: "user_message", text: "旧消息" },
        },
      ],
    }
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: [saved], alive: none, now: 999_999 }))
    expect(threadRowsOf(state)[0]?.thread.updatedAt).toBe(123)
  })

  it("活着的那份用宿主手上的当前状态收尾——journal 最后一条可能停在轮次中间", () => {
    const running: Thread = { ...thread("t1", "改过名了"), status: "running" }
    const alive = new Map<ThreadId, Thread>([["t1", running]])
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: [history("t1", "旧名字")], alive: alive, now: 1 }))
    expect(threadRowsOf(state)[0]?.thread.title).toBe("改过名了")
  })
})

describe("空壳会话不进侧栏", () => {
  it("**一句话都没说过的不算历史**——omni 每次启动都开一个默认会话，不滤掉的话跑一周侧栏全是空壳", () => {
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: [emptyHistory("空", "空")], alive: none, now: 1 }))
    expect(threadRowsOf(state)).toEqual([])
  })

  it("说过话的照常留着", () => {
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: [history("有话", "有话")], alive: none, now: 1 }))
    expect(threadRowsOf(state)).toHaveLength(1)
  })

  it("**活着的空会话是例外**——它正开着，用户随时会在里面打字", () => {
    const alive = new Map<ThreadId, Thread>([["空", thread("空", "空")]])
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: [emptyHistory("空", "空")], alive: alive, now: 1 }))
    expect(threadRowsOf(state)).toHaveLength(1)
  })
})

/**
 * 临时会话（`Thread.provisional`）**一个字都不落盘**，所以这份全量拼不出它。
 * 不补的话，⌘R 之后那个窗口整个消失，而它背后的引擎进程还活着。
 */
describe("活着但磁盘上什么都没有的会话", () => {
  const temp: Thread = { ...thread("临时", "临时"), provisional: true }

  it("**补出来**，⌘R 之后那个窗口还在", () => {
    const alive = new Map<ThreadId, Thread>([["临时", temp]])
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: NEWEST_FIRST, alive: alive, now: 1 }))
    expect(threadRowsOf(state).map((r) => r.thread.id)).toContain("临时")
  })

  it("补在最上面——它正是你刚才在用的那个", () => {
    const alive = new Map<ThreadId, Thread>([["临时", temp]])
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: NEWEST_FIRST, alive: alive, now: 1 }))
    expect(threadRowsOf(state)[0]?.thread.id).toBe("临时")
  })

  it("不标 detached：引擎进程还活着，输入框该是能用的", () => {
    const alive = new Map<ThreadId, Thread>([["临时", temp]])
    const state = reduceAll(initial(), replayEvents({ engines: [], threads: [], alive: alive, now: 1 }))
    expect(threadRowsOf(state)[0]?.thread.detached).toBeUndefined()
  })

  it("**磁盘上有记录的不重复补**——那条已经在全量里了", () => {
    const alive = new Map<ThreadId, Thread>([["t1", thread("t1", "最旧")]])
    const events = replayEvents({ engines: [], threads: NEWEST_FIRST, alive: alive, now: 1 })
    expect(events.filter((e) => e.type === "thread.started" && e.thread.id === "t1")).toHaveLength(1)
  })
})

/**
 * 进程在轮次中间没了（退应用、崩溃、记录写满）留下的那一轮。
 *
 * 真机现场：Kimi 那条会话发出「继续」之后 omni 被重启，记录里 114 次开始、113 次结束。
 * 重启后界面一直显示在跑，停止键发给早已空闲的 Kimi，按多少次都没反应。
 */
describe("停在半路的那一轮", () => {
  const turn = (id: string, at: number): Event => ({
    type: "turn.started", at, turn: { id, threadId: "t", engine: "kimi", status: "running", startedAt: at },
  })
  const said = (id: string, turnId: string, at: number, text: string): Event => ({
    type: "item.started", at, item: { id, turnId, at, kind: "user_message", text },
  })
  /** 现场那条的形状：上一轮按停止正常收口，接着说的「继续」没等到结束，进程就没了。 */
  const saved: ThreadHistory = {
    id: "t",
    events: [
      { type: "thread.started", at: 0, thread: thread("t", "托管平台") },
      turn("before", 1),
      said("u1", "before", 1, "你说的是这个配置吗？"),
      { type: "turn.completed", at: 2, turnId: "before", status: "interrupted" },
      turn("after", 3),
      said("u2", "after", 3, "继续"),
    ],
  }
  /** 重建一遍，看这条会话还挂着哪一轮。`status` 不给 = 背后没有引擎进程。 */
  const current = (status?: Thread["status"]): string | undefined => {
    const alive = status === undefined ? none : new Map<ThreadId, Thread>([["t", { ...thread("t", "托管平台"), status }]])
    return turnOf(reduceAll(initial(), replayEvents({ engines: [], threads: [saved], alive, now: 99 })), "t")?.id
  }

  it("**重启后宿主已空闲的，重建出来不再挂着那一轮**——停止键和运行指示跟着撤掉", () => {
    expect(current("idle")).toBeUndefined()
    expect(current("starting")).toBeUndefined()
  })

  it("背后没有引擎进程的历史也一样收口", () => {
    expect(current()).toBeUndefined()
  })

  it("**宿主手上真在跑的不收**——收了的话正在流的回答就没了主", () => {
    expect(current("running")).toBe("after")
    expect(current("waiting_approval")).toBe("after")
  })

  it("正常收口过的不重复补", () => {
    const done: ThreadHistory = { id: "t", events: saved.events.slice(0, 4) }
    const events = replayEvents({ engines: [], threads: [done], alive: none, now: 99 })
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1)
  })
})
