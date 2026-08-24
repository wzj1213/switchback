import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@omni/protocol"
import { emit, liveStateOf, ownerOf } from "./ctx.js"
import type { Ctx } from "./ctx.js"

const thread: Thread = {
  id: "th-1",
  title: "t",
  cwd: "/w",
  engine: "claude",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["claude"],
}

/** `ownerOf` 只用到 `turnOwner`，其余字段给个空壳就够。 */
const ctx = { turnOwner: new Map([["tu-1", "th-1"]]) } as unknown as Ctx

describe("一条事件属于哪个会话（决定落不落盘）", () => {
  it("thread.started / updated 从 thread 上取", () => {
    expect(ownerOf(ctx, { type: "thread.started", at: 0, thread })).toBe("th-1")
  })

  it("**改名必须落盘**——漏了这条的后果是改完重启就还原，而且一声不响", () => {
    expect(ownerOf(ctx, { type: "thread.renamed", at: 0, threadId: "th-1", title: "新名字" })).toBe("th-1")
  })

  it("item 通过 turnOwner 反查", () => {
    const event: Event = {
      type: "item.started",
      at: 0,
      item: { id: "it-1", kind: "agent_message", turnId: "tu-1", at: 0, text: "", complete: false },
    }
    expect(ownerOf(ctx, event)).toBe("th-1")
  })

  it("usage / engine.status / models 自己带 threadId", () => {
    expect(ownerOf(ctx, {
      type: "usage.updated", at: 0, threadId: "th-1", engine: "fake", usage: { contextUsed: 1 },
    })).toBe("th-1")
  })

  it("空 threadId 当作「不属于任何会话」——引擎级状态会这么报", () => {
    expect(ownerOf(ctx, { type: "engine.status", at: 0, threadId: "", status: "ready" })).toBeUndefined()
  })

  it("**thread.removed 不落盘**：写了只会把刚删掉的文件建回来", () => {
    expect(ownerOf(ctx, { type: "thread.removed", at: 0, threadId: "th-1" })).toBeUndefined()
  })

  it("**斜杠命令不落盘**：每次握手现问引擎，落盘只会在重放时塞回一份过期清单", () => {
    const event: Event = { type: "commands.updated", at: 0, threadId: "th-1", engine: "fake", commands: [] }
    expect(ownerOf(ctx, event)).toBeUndefined()
  })
})

describe("不落盘、但描述现状的事件（重建时要补发）", () => {
  /** `emit` 真的会写 `liveState`，所以这里给个能用的空壳。 */
  const fresh = (): Ctx =>
    ({
      deps: { emit: () => undefined, now: () => 0 },
      live: new Map([["th-1", {}]]),
      turnOwner: new Map(),
      inflight: new Map(),
      liveState: new Map(),
      uncommitted: new Map(),
      echo: new Map(),
      explained: new Map(),
    }) as unknown as Ctx

  const commands: Event = {
    type: "commands.updated",
    at: 0,
    threadId: "th-1",
    engine: "fake",
    commands: [{ name: "deck", description: "", source: "engine" }],
  }

  it("**斜杠命令要补发**——不补的话它既不在全量里、又被 `seq <= resumeAt` 丢掉，永久消失", () => {
    const ctx = fresh()
    emit(ctx, commands)
    expect(liveStateOf(ctx)).toEqual([commands])
  })

  it("只留最后一条：现状就是现状，补发两份旧的没有意义", () => {
    const ctx = fresh()
    emit(ctx, commands)
    const later: Event = { ...commands, at: 5, commands: [] }
    emit(ctx, later)
    expect(liveStateOf(ctx)).toEqual([later])
  })

  it("同一会话每家引擎各留一份目录，失败回滚或重载不会丢旧目录", () => {
    const ctx = fresh()
    const other: Event = { ...commands, engine: "other", commands: [] }
    emit(ctx, commands)
    emit(ctx, other)
    expect(liveStateOf(ctx)).toEqual([commands, other])
  })

  it("额度按引擎分键——键错了两家引擎只会剩一份", () => {
    const ctx = fresh()
    const a: Event = { type: "limits.updated", at: 0, engine: "codex", limits: {} }
    const b: Event = { type: "limits.updated", at: 0, engine: "claude", limits: {} }
    emit(ctx, a)
    emit(ctx, b)
    expect(liveStateOf(ctx)).toHaveLength(2)
  })

  it("**`thread.removed` 不在这份里**：它是一次变化，补发只会把删掉的东西变回来", () => {
    const ctx = fresh()
    emit(ctx, { type: "thread.removed", at: 0, threadId: "th-1" })
    expect(liveStateOf(ctx)).toEqual([])
  })

  it("删除会话会同时回收它的斜杠命令现状", () => {
    const ctx = fresh()
    emit(ctx, commands)
    emit(ctx, { type: "thread.removed", at: 1, threadId: "th-1" })
    expect(liveStateOf(ctx)).toEqual([])
  })

  it("会话已经不在了就别补了——那一行界面上都没有", () => {
    const ctx = fresh()
    emit(ctx, { ...commands, threadId: "th-gone" })
    expect(liveStateOf(ctx)).toEqual([])
  })
})

/**
 * 这一组钉的是**磁盘和渲染帧**，不是界面上看得见的东西。
 *
 * 实测：ACP 那条线把同一份工具投影翻译出来 9793 遍（一条调用 2.7 MB），
 * 而宿主自己十几处发的 `thread.updated` 里有 837 条是原样重发（0.73 MB）。
 * 单会话 32 MB 的上限就是被这些撞满的——之后那条会话不再落盘。
 */
describe("回声挡在唯一出口上", () => {
  const message = (id: string, text: string): Event => ({
    type: "item.updated",
    at: 0,
    item: { id, turnId: "tu-1", at: 0, kind: "agent_message", text, complete: false },
  })

  function rig(): { ctx: Ctx; seen: Event[]; written: Event[] } {
    const seen: Event[] = []
    const written: Event[] = []
    const ctx = {
      deps: {
        emit: (e: Event) => seen.push(e),
        now: () => 0,
        newId: (prefix: string) => `${prefix}-x`,
        journal: {
          append: (_owner: string, e: Event) => {
            written.push(e)
            return Promise.resolve()
          },
        },
      },
      live: new Map([["th-1", {}]]),
      turnOwner: new Map([["tu-1", "th-1"]]),
      inflight: new Map(),
      liveState: new Map(),
      uncommitted: new Map(),
      echo: new Map(),
      explained: new Map(),
    } as unknown as Ctx
    return { ctx, seen, written }
  }

  it("**同一条 item 重发一千遍只算一条**——这就是把会话记录撑到 32 MB 上限的那个洞", () => {
    const { ctx, seen, written } = rig()
    for (let i = 0; i < 1000; i += 1) emit(ctx, { ...message("it-1", "一样的"), at: i })
    expect(written).toHaveLength(1)
    expect(seen).toHaveLength(1)
  })

  it("内容真的变了就照发——这道闸门丢掉的字节数是零", () => {
    const { ctx, written } = rig()
    emit(ctx, message("it-1", "一"))
    emit(ctx, message("it-1", "一二"))
    emit(ctx, message("it-1", "一二"))
    emit(ctx, message("it-1", "一二三"))
    expect(written.map((e) => (e.type === "item.updated" && e.item.kind === "agent_message" ? e.item.text : ""))).toEqual([
      "一",
      "一二",
      "一二三",
    ])
  })

  it("**`item.delta` 一条都不能挡**——两条一样的增量是两次真的追加，挡了正文就少一截", () => {
    const { ctx, seen } = rig()
    const delta: Event = { type: "item.delta", at: 0, itemId: "it-1", append: "啊" }
    emit(ctx, delta)
    emit(ctx, delta)
    emit(ctx, delta)
    expect(seen).toHaveLength(3)
  })

  it("**`thread.updated` 也挡**——它不是引擎发的，是宿主自己十几处各发一遍的", () => {
    const { ctx, written } = rig()
    const updated: Event = { type: "thread.updated", at: 0, thread }
    emit(ctx, updated)
    emit(ctx, { ...updated, at: 9 })
    expect(written).toHaveLength(1)
  })

  it("**`updatedAt` 变了就是真的变了**——事件的 `at` 抹掉，会话自己的时间戳不能抹", () => {
    const { ctx, written } = rig()
    emit(ctx, { type: "thread.updated", at: 0, thread })
    emit(ctx, { type: "thread.updated", at: 0, thread: { ...thread, updatedAt: 7 } })
    expect(written).toHaveLength(2)
  })

  it("轮次事件从不挡，而且收工时清账——不清的话驻留量是整条会话而不是一轮", () => {
    const { ctx, written } = rig()
    const done: Event = { type: "turn.completed", at: 0, turnId: "tu-1", status: "completed" }
    emit(ctx, message("it-1", "同一句"))
    emit(ctx, done)
    emit(ctx, done)
    emit(ctx, message("it-1", "同一句"))
    expect(written.filter((e) => e.type === "turn.completed")).toHaveLength(2)
    expect(written.filter((e) => e.type === "item.updated")).toHaveLength(2)
  })
})
