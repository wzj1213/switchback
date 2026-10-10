import { describe, expect, it } from "vitest"
import type { Event, Item } from "@switchback/protocol"
import type { EngineDriver, EngineSession } from "@switchback/engine"
import { createHost, type Host } from "./host.js"

/**
 * 分叉的两条路：同一家引擎让它自己复制会话（上下文一点不少），
 * 换一家只开同工作区的空白分支（各家会话格式不通，Switchback 不注入文本）。
 *
 * 这里钉的是**选哪条路**以及**选错时会发生什么**——后者更要紧：
 * 普通分叉可退回空白分支；“从这里重来”承诺上下文，失败必须明说。
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
  /** 内存里的「磁盘」。用来钉「没说话就不落盘」。 */
  disk: Map<string, Event[]>
  flushes: () => number
}

const rig = (opts: {
  canFork: boolean
  canRewind?: boolean
  nativeOnFork?: boolean
  failActivateOnFork?: boolean
}): Rig => {
  const events: Event[] = []
  const forks: { handle: string; dropTurns?: number }[] = []
  const prompts: string[] = []
  const resumed: (string | undefined)[] = []
  const fail = { now: false }
  const counter = { n: 0 }
  const emitters: ((e: Event) => void)[] = []
  let flushes = 0
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
        activate: () => {
          if (req.forkOf !== undefined && opts.failActivateOnFork === true) {
            return Promise.reject(new Error("分叉后的实时连接失败"))
          }
          if (req.forkOf !== undefined && opts.nativeOnFork === true) {
            const turnId = req.onNativeTurn?.({
              at: 1,
              prompt: "定时检查",
              origin: { kind: "scheduled", taskId: "job", schedule: "* * * * *",
                recurring: true, coalescedCount: 1, stale: false },
            })
            if (turnId !== undefined) req.emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
          }
          return Promise.resolve()
        },
        prompt: (text: string) => {
          prompts.push(text)
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => ({
          compact: false,
          attachments: id === "other",
          steer: false,
          fork: opts.canFork,
          rewind: opts.canRewind ?? opts.canFork,
        }),
        setModel: () => Promise.resolve({}),
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
      flush: () => {
        flushes += 1
        return Promise.resolve()
      },
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
    disk: files,
    flushes: () => flushes,
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
  it("轮次仍在运行时，宿主同时拒绝分叉与历史回退", async () => {
    const r = rig({ canFork: true })
    await r.host.dispatch({ type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" })
    const id = r.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "正在处理" })
    const turnId = r.events.filter((event) => event.type === "turn.started").at(-1)?.turn.id ?? ""
    const started = r.events.filter((event) => event.type === "thread.started").length

    await expect(r.host.dispatch({ type: "thread.fork", threadId: id, to: "other" }))
      .rejects.toThrow("当前轮次尚未结束")
    await expect(r.host.dispatch({ type: "thread.rewind", threadId: id, turnId }))
      .rejects.toThrow("当前轮次尚未结束")
    expect(r.events.filter((event) => event.type === "thread.started")).toHaveLength(started)
  })

  it("读 transcript 前等待在途 journal 写完", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.flushes()).toBe(1)
  })

  it("普通分叉不因可见 transcript 暂时为空而放弃原生上下文", async () => {
    const r = rig({ canFork: true })
    await r.host.dispatch({ type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" })
    const id = r.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.forks).toHaveLength(1)
  })

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

  it("原生主动轮在继承记录搬完后才接入，不会跑到父会话历史前面", async () => {
    const r = rig({ canFork: true, nativeOnFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const forked = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    const said = itemsOfThread(r.events, forked).filter((i) => i.kind === "user_message")

    expect(said.map((item) => item.text)).toEqual(["第一句", "第二句", "定时检查"])
    expect(said.slice(0, 2).every((item) => item.inherited === true)).toBe(true)
    expect(said[2]?.origin).toMatchObject({ kind: "scheduled", taskId: "job" })
  })

  it("原生分叉已建立但实时激活失败时不退成空白分支", async () => {
    const r = rig({ canFork: true, failActivateOnFork: true })
    const { id } = await withTurns(r)
    const starts = r.resumed.length

    await expect(r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" }))
      .rejects.toThrow("实时连接失败")
    expect(r.resumed).toHaveLength(starts + 1)
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

  it("第一轮之前重来就是空白分支，不调用不存在的 beforeTurnId", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[0] ?? "" })
    const born = r.events.filter((event) => event.type === "thread.started").at(-1)?.thread

    expect(r.forks).toEqual([])
    expect(born).toMatchObject({ forkedFrom: id, forkedFromItemCount: 0, provisional: true })
    expect(itemsOfThread(r.events, born?.id ?? "")).toEqual([])
  })

  it("**「改一改再发」：那句话交还到新会话的输入框里**，不留在转录区当第二条", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({
      type: "thread.rewind",
      threadId: id,
      turnId: turns[1] ?? "",
      draft: "换个说法再问一次",
      draftAttachments: ["/tmp/a.png"],
    })
    const born = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread
    expect(born).toMatchObject({
      draft: "换个说法再问一次",
      draftAttachments: ["/tmp/a.png"],
      // **身份必须一起给**：输入框靠它认「这是新的一次要求」，没有的话那段字进不去
      draftRevision: expect.stringMatching(/^dr/),
    })
  })

  it("不带 draft 的重来照旧是干净的——轮次分隔线上那颗「从这里重来」走这条", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "" })
    const born = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread
    expect(born?.draft).toBeUndefined()
    expect(born?.draftRevision).toBeUndefined()
  })

  it("引擎不支持原生 fork 时不显示成功假象，重来明确失败", async () => {
    const r = rig({ canFork: false })
    const { id, turns } = await withTurns(r)
    const before = r.events.filter((event) => event.type === "thread.started").length
    await expect(
      r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "" }),
    ).rejects.toThrow("不能带着原生上下文")
    expect(r.events.filter((event) => event.type === "thread.started")).toHaveLength(before)
  })

  it("只支持完整 fork 的引擎不能把完整历史冒充成从某轮重来", async () => {
    const r = rig({ canFork: true, canRewind: false })
    const { id, turns } = await withTurns(r)
    const before = r.events.filter((event) => event.type === "thread.started").length

    await expect(
      r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "" }),
    ).rejects.toThrow("不能带着原生上下文")
    expect(r.forks).toEqual([])
    expect(r.events.filter((event) => event.type === "thread.started")).toHaveLength(before)
  })

  it("历史轮次不存在时明确失败，不把完整分叉冒充成重来", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    const before = r.events.filter((event) => event.type === "thread.started").length
    await expect(
      r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: "turn-gone" }),
    ).rejects.toThrow("找不到要重来的历史轮次")
    expect(r.events.filter((event) => event.type === "thread.started")).toHaveLength(before)
  })

  it("原生 fork 运行时失败也不静默降级成空白重来", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    const starts = r.resumed.length
    r.fail.now = true
    await expect(
      r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "" }),
    ).rejects.toThrow("引擎这次不肯分")
    expect(r.resumed).toHaveLength(starts + 1)
  })

  it("整条复制时不丢任何一轮", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.forks[0]?.dropTurns).toBeUndefined()
  })
})

describe("派生会话的引擎身份", () => {
  it("不继承父分支句柄段，握手完成事件采用新引擎能力", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "other" })
    const born = r.events.filter((event) => event.type === "thread.started").at(-1)?.thread
    const ready = [...r.events].reverse().find(
      (event): event is Extract<Event, { type: "thread.updated" }> =>
        event.type === "thread.updated" && event.thread.id === born?.id,
    )?.thread
    expect(born?.segments).toEqual([])
    expect(ready?.capabilities?.attachments).toBe(true)
  })
})

/** 一条会话现在挂着的宿主草稿；分叉不再生成任何草稿文本。 */
const draftOf = (events: Event[], id: string): string | undefined =>
  events
    .filter((e) => e.type === "thread.updated")
    .filter((e) => e.thread.id === id)
    .at(-1)?.thread.draft

/** 分叉/接力之后新建的那条会话。 */
const newThreadId = (events: Event[]): string =>
  events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""

/**
 * 普通分叉分不了原生 fork 时只开空白分支，不注入文字。
 *
 * 旧实现会从 transcript 提炼一段话塞进输入框；那段话是**用户没打过的**。
 * 现在分叉只做分叉：新会话开出来，一个字都不替他写。
 */
describe("分不了就只是分不了", () => {
  it("分不了：新会话照样开出来，**输入框里一个字都没有**", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    r.fail.now = true
    r.prompts.length = 0
    await expect(r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })).resolves.toBeUndefined()
    expect(r.prompts).toEqual([])
    expect(draftOf(r.events, newThreadId(r.events))).toBeUndefined()
  })

  it("引擎报了 fork:false 就不去试，也不塞文本", async () => {
    const r = rig({ canFork: false })
    const { id } = await withTurns(r)
    r.prompts.length = 0
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.forks).toHaveLength(0)
    expect(r.prompts).toEqual([])
    expect(draftOf(r.events, newThreadId(r.events))).toBeUndefined()
  })

  // 原生分叉成功那条路本来就不该有文本（引擎自己什么都记得），这里一并钉住
  it("原生分叉成功也一样：不发、不塞", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    r.prompts.length = 0
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "other" })
    expect(r.prompts).toEqual([])
    expect(draftOf(r.events, newThreadId(r.events))).toBeUndefined()
  })
})

/**
 * 派生出来的会话先算**临时的**——和「+ 新建」同一条规矩（`Thread.provisional`）。
 *
 * 钉的是「取消不留痕」这件事的三个面：不进侧栏的那个标记、不落盘、以及
 * **没用过就被回收**。三条里漏掉任何一条，「点一下看看」的代价就又变成
 * 一条永久的历史（或者一个看不见却还活着的引擎进程）。
 */
describe("分叉与重来：没用过的那条不该留下痕迹", () => {
  const forkOf = (r: Rig, parent: string): string => {
    const started = r.events.filter((e) => e.type === "thread.started").map((e) => e.thread)
    return started.find((t) => t.forkedFrom === parent)?.id ?? ""
  }

  it("分出来那条带着 `provisional`——它还没干过任何事", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const born = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread
    expect(born).toMatchObject({ forkedFrom: id, forkedFromItemCount: 2 })
    expect(born?.provisional).toBe(true)
  })

  it("「从这里重来」也一样——它同样是探索性的动作", async () => {
    const r = rig({ canFork: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "" })
    expect(r.events.filter((e) => e.type === "thread.started").at(-1)?.thread).toMatchObject({
      provisional: true,
      forkedFromItemCount: 1,
    })
  })

  it("**没说话就不落盘**：磁盘上一个字都没有", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.disk.get(forkOf(r, id))).toBeUndefined()
  })

  it("说了第一句就转正，**抄过来的 transcript 跟着一起落盘、而且排在轮次前面**", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const forked = forkOf(r, id)
    await r.host.dispatch({ type: "thread.prompt", threadId: forked, text: "接着这个方向" })
    const written = r.disk.get(forked) ?? []
    // 出生那条排最前：顺序反了的话，重放出来是「先被改过、后才出生」的会话
    expect(written[0]?.type).toBe("thread.started")
    // 用户新开的那一轮是最后一条 `turn.started`；**抄过来的历史整段在它之前**
    // ——反过来的话，重放出来是「先说了新的一句，历史才补上」，读不懂
    const userTurn = written.map((e, i) => (e.type === "turn.started" ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1
    const copiedBefore = written.slice(0, userTurn).filter((e) => e.type === "item.started")
    expect(userTurn).toBeGreaterThan(0)
    expect(copiedBefore.length).toBeGreaterThan(0)
    // 转正之后 `provisional` 就没了——侧栏和磁盘看的是同一个信号
    const live = r.events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === forked)
      .at(-1)
    expect(live?.thread.provisional).toBeUndefined()
  })

  it("再分一次，把上一条**没用过的**收掉——不然它看不见却还占着一个引擎进程", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const first = forkOf(r, id)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.events.filter((e) => e.type === "thread.removed").map((e) => e.threadId)).toContain(first)
  })

  it("**来路那条不动**：从一个临时会话上分叉是合法的，收掉来路等于抽走脚下的地板", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const source = forkOf(r, id)
    await r.host.dispatch({ type: "thread.fork", threadId: source, to: "fake" })
    const derived = forkOf(r, source)
    const copied = itemsOfThread(r.events, derived).filter((item) => item.kind === "user_message")
    expect(copied.map((item) => item.text)).toEqual(["第一句", "第二句"])
    expect(r.events.filter((e) => e.type === "thread.removed").map((e) => e.threadId)).not.toContain(source)
  })

  it("已经说过话的那条不会被收走——它不再是临时的", async () => {
    const r = rig({ canFork: true })
    const { id } = await withTurns(r)
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    const used = forkOf(r, id)
    await r.host.dispatch({ type: "thread.prompt", threadId: used, text: "用起来了" })
    await r.host.dispatch({ type: "thread.fork", threadId: id, to: "fake" })
    expect(r.events.filter((e) => e.type === "thread.removed").map((e) => e.threadId)).not.toContain(used)
  })
})

describe("原生分叉出来的会话一出生就带着上下文", () => {
  it("还没开口时在下拉里换一家再换回来：续的是它自己的原生分叉，不是起一条空白会话", async () => {
    const r = rig({ canFork: true, canRewind: true })
    const { id, turns } = await withTurns(r)
    await r.host.dispatch({ type: "thread.rewind", threadId: id, turnId: turns[1] ?? "", draft: "第二句：换个说法" })
    const derived = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    expect(r.forks.at(-1)).toMatchObject({ dropTurns: 1 })
    await r.host.dispatch({ type: "thread.handoff", threadId: derived, to: "other" })
    await r.host.dispatch({ type: "thread.handoff", threadId: derived, to: "fake" })
    expect(r.resumed.at(-1)).toBe("cx-forked")
  })
})
