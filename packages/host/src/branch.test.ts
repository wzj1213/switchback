import { describe, expect, it } from "vitest"
import type { Event, Item } from "@omni/protocol"
import type { EngineDriver, EngineSession } from "@omni/engine"
import { createHost, type Host } from "./host.js"

/**
 * 分叉的两条路：同一家引擎让它自己复制会话（上下文一点不少），
 * 换一家只能递交接包（各家会话格式不通）。
 *
 * 这里钉的是**选哪条路**以及**选错时会发生什么**——后者更要紧：
 * 原生分叉失败必须退回交接包，而不是把一个能用的功能变成会报错的功能。
 */

interface Rig {
  host: Host
  events: Event[]
  forks: { handle: string; dropTurns?: number }[]
  prompts: string[]
  resumed: (string | undefined)[]
  fail: { now: boolean }
  /** 冒充引擎报一轮收工。走驱动的 emit，所以会落进 journal。 */
  complete: (turnId: string) => void
}

const rig = (opts: { canFork: boolean }): Rig => {
  const events: Event[] = []
  const forks: { handle: string; dropTurns?: number }[] = []
  const prompts: string[] = []
  const resumed: (string | undefined)[] = []
  const fail = { now: false }
  const counter = { n: 0 }
  const emitters: ((e: Event) => void)[] = []
  const make = (id: string): EngineDriver => ({
    id,
    start: (req) => {
      resumed.push(req.resume)
      emitters.push(req.emit)
      if (req.forkOf !== undefined) {
        if (fail.now) return Promise.reject(new Error("引擎这次不肯分"))
        forks.push(req.forkOf)
      }
      // 引擎握手时报出自己的句柄——分叉出来的那条也一样
      req.onHandle?.(req.forkOf === undefined ? `cx-${String(++counter.n)}` : "cx-forked")
      return Promise.resolve({
        threadId: req.threadId,
        prompt: (text: string) => {
          prompts.push(text)
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve(),
        models: () => Promise.resolve([]),
        capabilities: () => ({ compact: false, attachments: false, steer: false, fork: opts.canFork }),
        setModel: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
      } as unknown as EngineSession)
    },
  })
  /** 内存 journal。`branch()` 的上下文是**从日志读回来的**，没有它就没得抄。 */
  const files = new Map<string, Event[]>()
  const host = createHost({
    drivers: { fake: make("fake"), other: make("other") },
    home: "/home/dev",
    journal: {
      append: (threadId, e) => {
        files.set(threadId, [...(files.get(threadId) ?? []), e])
        return Promise.resolve()
      },
      flush: () => Promise.resolve(),
      read: (threadId) => Promise.resolve(files.get(threadId) ?? []),
      list: () => Promise.resolve([...files.keys()]),
      remove: (threadId) => {
        files.delete(threadId)
        return Promise.resolve()
      },
    },
    emit: (e) => events.push(e),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => 0,
  })
  return {
    host,
    events,
    forks,
    prompts,
    resumed,
    fail,
    complete: (turnId) => {
      emitters[0]?.({ type: "turn.completed", at: 0, turnId, status: "completed" })
    },
  }
}

/** 起一条会话并跑两轮，让它有可分的东西。 */
const withTurns = async (r: Rig): Promise<{ id: string; turns: string[] }> => {
  await r.host.dispatch({ type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" })
  const id = r.events.find((e) => e.type === "thread.started")?.thread.id ?? ""
  const turns: string[] = []
  for (const text of ["第一句", "第二句"]) {
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text })
    const turnId = r.events.filter((e) => e.type === "turn.started").at(-1)?.turn.id ?? ""
    turns.push(turnId)
    // 走真的出口，不是往数组里塞——journal 是靠 emit 写的
    r.complete(turnId)
  }
  return { id, turns }
}

const itemsOfThread = (events: Event[], threadId: string): Item[] => {
  const owner = new Map<string, string>()
  for (const e of events) if (e.type === "turn.started") owner.set(e.turn.id, e.turn.threadId)
  return events
    .filter((e) => e.type === "item.started")
    .map((e) => e.item)
    .filter((i) => owner.get(i.turnId) === threadId)
}

describe("同一家引擎：让它自己复制会话", () => {
  it("**不发交接包**——引擎已经亲历过了，再复述一遍是多余的", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    r.prompts.length = 0
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.forks).toHaveLength(1)
    expect(r.prompts).toEqual([])
  })

  it("**告诉新引擎去分哪一条**，而不是老引擎分好了交过来（那会撞写锁）", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    // 分的必须是**原会话**那条引擎侧句柄
    const sourceHandle = r.events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === id)
      .at(-1)?.thread.engineHandle
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(sourceHandle).toBeDefined()
    // 不走 resume：**新进程自己去 fork**，老进程分好再交过来会撞写锁
    expect(r.forks[0]?.handle).toBe(sourceHandle)
    expect(r.resumed.filter((h) => h !== undefined)).toEqual([])
  })

  it("**上下文抄进新会话的 transcript**：引擎记得，界面上也得看得见", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const forked = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    const said = itemsOfThread(r.events, forked).filter((i) => i.kind === "user_message")
    expect(said.map((i) => i.text)).toEqual(["第一句", "第二句"])
  })

  it("**turn id 重新铸**：沿用旧的会把新会话的记录写进原会话的文件里", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const forked = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    const copied = itemsOfThread(r.events, forked).map((i) => i.turnId)
    expect(copied.some((t) => turns.includes(t))).toBe(false)
  })

  it("抄过来的每一轮都补一条收工，否则界面上它们永远停在「正在跑」", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    const before = r.events.filter((e) => e.type === "turn.completed").length
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const forked = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    const started = r.events.filter((e) => e.type === "turn.started" && e.turn.threadId === forked).length
    expect(r.events.filter((e) => e.type === "turn.completed").length - before).toBe(started)
  })

  it("重来告诉引擎丢掉几轮——从第二轮重来就是丢 1 轮", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "" })
    expect(r.forks[0]?.dropTurns).toBe(1)
  })

  it("整条复制时不丢任何一轮", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.forks[0]?.dropTurns).toBeUndefined()
  })
})

/** 一条会话现在挂着的草稿。交接包不再发出去，而是摆进输入框等你改。 */
const draftOf = (events: Event[], id: string): string | undefined =>
  events
    .filter((e) => e.type === "thread.updated")
    .filter((e) => e.thread.id === id)
    .at(-1)?.thread.draft

/** 分叉/接力之后新建的那条会话。 */
const newThreadId = (events: Event[]): string =>
  events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""

describe("退回交接包的两种情况", () => {
  it("换一家引擎：会话格式不通，只能递交接包——**但挂成草稿，不发出去**", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    r.prompts.length = 0
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "other" })
    expect(r.forks).toHaveLength(0)
    // **一条都不发。** 上一版是直接发出去的，于是「分叉一份」变成了
    // 「分叉一份并且立刻开跑」，而那段话还是 omni 替用户写的
    expect(r.prompts).toEqual([])
    expect(draftOf(r.events, newThreadId(r.events))).toBeDefined()
  })

  it("**引擎不肯分就退回交接包，不报错**——把能用的功能变成会报错的，是把好的换成差的", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    r.fail.now = true
    r.prompts.length = 0
    await expect(r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })).resolves.toBeUndefined()
    expect(r.prompts).toEqual([])
    expect(draftOf(r.events, newThreadId(r.events))).toBeDefined()
  })

  it("引擎报了 fork:false 就直接走交接包，不去试", async () => {
    const r = rig({ canFork: false })
    const { id } = await withTurns(r)
    r.prompts.length = 0
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.forks).toHaveLength(0)
    expect(r.prompts).toEqual([])
    expect(draftOf(r.events, newThreadId(r.events))).toBeDefined()
  })

  it("**草稿里带着目标**：接手的一家要被告知做什么，只是由你按下回车", async () => {
    const r = rig({ canFork: false })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(draftOf(r.events, newThreadId(r.events))).toContain("第一句")
  })
})
