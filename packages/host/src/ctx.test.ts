import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@switchback/protocol"
import { createPaceBook } from "@switchback/store"
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
    expect(ownerOf(ctx, { type: "item.removed", at: 1, turnId: "tu-1", itemId: "it-1" })).toBe("th-1")
  })

  it("只有明确带会话身份的流式增量落盘；普通增量等终态整条快照", () => {
    expect(ownerOf(ctx, {
      type: "item.delta", at: 0, threadId: "th-1", itemId: "it-1", append: "monitor output",
    })).toBe("th-1")
    expect(ownerOf(ctx, { type: "item.delta", at: 0, itemId: "it-1", append: "token" })).toBeUndefined()
    expect(ownerOf(ctx, {
      type: "item.delta", at: 0, threadId: "", itemId: "it-1", append: "orphan",
    })).toBeUndefined()
  })

  it("usage / engine.status / models / thinking 自己带 threadId", () => {
    expect(ownerOf(ctx, {
      type: "usage.updated", at: 0, threadId: "th-1", engine: "fake", usage: { contextUsed: 1 },
    })).toBe("th-1")
    expect(ownerOf(ctx, {
      type: "thinking.updated", at: 0, threadId: "th-1", turnId: "tu-1", estimatedTokens: 1,
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
      pace: createPaceBook(),
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

  it("额度按引擎分键，并把同一家稀疏窗口合成可重建的现状", () => {
    const ctx = fresh()
    const primary = { usedPercent: 20, windowDurationMins: 10_080 }
    const secondary = { usedPercent: 80, windowDurationMins: 300 }
    const a: Event = { type: "limits.updated", at: 0, engine: "codex", limits: { primary } }
    const patch: Event = { type: "limits.updated", at: 1, engine: "codex", limits: { secondary } }
    const b: Event = { type: "limits.updated", at: 0, engine: "claude", limits: {} }
    emit(ctx, a)
    emit(ctx, patch)
    emit(ctx, b)
    expect(liveStateOf(ctx)).toHaveLength(2)
    expect(liveStateOf(ctx).find((event) => event.type === "limits.updated" && event.engine === "codex"))
      .toMatchObject({ at: 1, limits: { primary, secondary } })

    emit(ctx, { type: "limits.updated", at: 2, engine: "codex", limits: {} })
    expect(liveStateOf(ctx).find((event) => event.type === "limits.updated" && event.engine === "codex"))
      .toMatchObject({ at: 2, limits: {} })
  })

  it("重载只补当前思考进度，清空后不留陈旧值", () => {
    const ctx = fresh()
    const progress: Event = {
      type: "thinking.updated", at: 1, threadId: "th-1", turnId: "tu-1", estimatedTokens: 42,
    }
    emit(ctx, progress)
    expect(liveStateOf(ctx)).toEqual([progress])

    emit(ctx, { type: "thinking.updated", at: 2, threadId: "th-1", turnId: "tu-1" })
    expect(liveStateOf(ctx)).toEqual([])
  })

  it("重载会补当前子 agent 任务，轮次收工后立即清掉", () => {
    const ctx = fresh()
    const tasks: Event = {
      type: "tasks.updated", at: 1, threadId: "th-1",
      tasks: [{ id: "task-1", description: "正在检查测试", toolUses: 2, ms: 900 }],
    }
    emit(ctx, { type: "turn.started", at: 0, turn: {
      id: "tu-1", threadId: "th-1", engine: "claude", status: "running", startedAt: 0,
    } })
    emit(ctx, tasks)
    expect(liveStateOf(ctx)).toEqual([tasks])
    emit(ctx, { type: "turn.completed", at: 2, turnId: "tu-1", status: "completed" })
    expect(liveStateOf(ctx)).toEqual([])
  })

  it("轮次归属在终态发完后回收，不随长会话永久增长", async () => {
    const ctx = fresh()
    emit(ctx, { type: "turn.started", at: 0, turn: {
      id: "tu-1", threadId: "th-1", engine: "claude", status: "running", startedAt: 0,
    } })
    emit(ctx, { type: "turn.completed", at: 1, turnId: "tu-1", status: "completed" })
    await Promise.resolve()
    expect(ctx.turnOwner.has("tu-1")).toBe(false)
  })

  it("**`thread.removed` 不在这份里**：它是一次变化，补发只会把删掉的东西变回来", () => {
    const ctx = fresh()
    emit(ctx, { type: "thread.removed", at: 0, threadId: "th-1" })
    expect(liveStateOf(ctx)).toEqual([])
  })

  it("删除会话会同时回收它的斜杠命令、思考与子任务现状", () => {
    const ctx = fresh()
    emit(ctx, commands)
    emit(ctx, {
      type: "thinking.updated", at: 0, threadId: "th-1", turnId: "tu-1", estimatedTokens: 9,
    })
    emit(ctx, { type: "tasks.updated", at: 0, threadId: "th-1", tasks: [
      { id: "task-1", description: "还在跑", toolUses: 1, ms: 3 },
    ] })
    emit(ctx, { type: "thread.removed", at: 1, threadId: "th-1" })
    expect(liveStateOf(ctx)).toEqual([])
  })

  it("会话已经不在了就别补了——那一行界面上都没有", () => {
    const ctx = fresh()
    emit(ctx, { ...commands, threadId: "th-gone" })
    emit(ctx, { type: "tasks.updated", at: 0, threadId: "th-gone", tasks: [
      { id: "late", description: "迟到任务", toolUses: 1, ms: 2 },
    ] })
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
  const message = (id: string, text: string): Extract<Event, { type: "item.updated" }> => ({
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
      turnOwner: new Map([["tu-1", "th-1"], ["tu-2", "th-1"]]),
      inflight: new Map(),
      liveState: new Map(),
      uncommitted: new Map(),
      echo: new Map(),
      explained: new Map(),
      pace: createPaceBook(),
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

  it("轮次事件从不挡", () => {
    const { ctx, seen, written } = rig()
    const done: Event = { type: "turn.completed", at: 0, turnId: "tu-1", status: "completed" }
    emit(ctx, message("it-1", "同一句"))
    emit(ctx, done)
    emit(ctx, done)
    expect(written.filter((e) => e.type === "turn.completed")).toHaveLength(2)
    expect(seen.filter((e) => e.type === "turn.completed")).toHaveLength(2)
  })

  it("一条会话收工只清自己的回声，不能让另一条在途轮次的重复快照穿透", async () => {
    const { ctx, written } = rig()
    const other: Event = {
      ...message("it-2", "另一轮还在跑"),
      item: { ...message("it-2", "另一轮还在跑").item, turnId: "tu-2" },
    }
    emit(ctx, message("it-1", "第一轮"))
    emit(ctx, other)
    emit(ctx, { type: "turn.completed", at: 1, turnId: "tu-1", status: "completed" })
    await Promise.resolve()
    emit(ctx, { ...other, at: 2 })
    expect(written.filter((event) => event.type === "item.updated" && event.item.id === "it-2"))
      .toHaveLength(1)
  })
})
