import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { Event, Item } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk, EngineDriver, EngineSession } from "@omni/engine"
import type { EngineAxis } from "@omni/protocol"
import type { Rule } from "@omni/approval"
import type { StoredRule } from "@omni/journal"
import { createHost, type Host } from "./host.js"

interface Fake {
  prompts: { text: string; turnId: string }[]
  disposed: boolean
  ask: (a: ApprovalAsk) => Promise<ApprovalAnswer>
  /** 驱动侧的出口。测试用它冒充引擎发事件，走宿主包装过的那条路。 */
  emit: (e: Event) => void
  /** 宿主传下来的续跑句柄。没传就是新会话。 */
  resume: string | undefined
  /** 驱动上报自己的会话句柄 */
  handle: (handle: string) => void
  /** 引擎**自己**换了模型 / 强度（ACP 的 `config_option_update` 那条路） */
  drift: (model?: string, effort?: string) => void
  /** 引擎自报当前状态（`current_mode_update` 那条路） */
  report: (patch: { axes?: readonly EngineAxis[]; modelId?: string }) => void
  /** 当前生效的记忆规则。取值函数——中途加的规则要立刻能读到。 */
  memory: () => readonly Rule[]
}

/** 引擎回报的强度怎么算。缺省 = 照单全收；传进来就是「它其实用的是这个」。 */
type EffortOf = (effort?: string) => { effort?: string }

function fakeDriver(effortOf?: EffortOf, aside = true): { driver: EngineDriver; session: () => Fake } {
  const holder: { fake: Fake | undefined } = { fake: undefined }
  const driver: EngineDriver = {
    id: "fake",
    start: (req) => {
      const fake: Fake = {
        prompts: [],
        disposed: false,
        ask: req.askUser,
        emit: req.emit,
        resume: req.resume,
        handle: (handle) => req.onHandle?.(handle),
        drift: (model, effort) => req.onModel?.(model, effort),
        report: (patch) => req.onEngineState?.(patch),
        memory: req.memory,
      }
      holder.fake = fake
      const session: EngineSession = {
        threadId: req.threadId,
        prompt: (text, turnId) => {
          fake.prompts.push({ text, turnId })
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        // `aside: false` 演一家**不实现**侧问的引擎——它该抛，不该静默吞
        ...(aside ? { askAside: (text: string) => Promise.resolve(`答：${text}`) } : {}),
        capabilities: () => NO_CAPABILITIES,
        // 一个**认强度**的引擎：回报的就是收到的那个。设不上的那家靠 `effortOf` 演
        setModel: (_model: string, effort?: string) =>
          Promise.resolve(effortOf === undefined ? (effort === undefined ? {} : { effort }) : effortOf(effort)),
        dispose: () => {
          fake.disposed = true
          return Promise.resolve()
        },
      }
      return Promise.resolve(session)
    },
  }
  return {
    driver,
    session: () => {
      const fake = holder.fake
      if (fake === undefined) throw new Error("会话还没建")
      return fake
    },
  }
}

function setup(options: { effort?: EffortOf; aside?: boolean } = {}): { host: Host; events: Event[]; session: () => Fake } {
  const { driver, session } = fakeDriver(options.effort, options.aside ?? true)
  const events: Event[] = []
  const counter = { n: 0 }
  const host = createHost({
    drivers: { fake: driver },
    home: "/home/dev",
    emit: (e) => events.push(e),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => 0,
  })
  return { host, events, session }
}

const create = { type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" } as const

const items = (events: Event[]): Item[] =>
  events.filter((e) => e.type === "item.started" || e.type === "item.updated").map((e) => e.item)

const ask: ApprovalAsk = {
  toolCallId: "toolu_1",
  tool: "Bash",
  summary: "git push",
  reason: "推送到远端不可逆",
}

describe("host", () => {
  it("建会话后发 thread.started", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    expect(events.filter((e) => e.type === "thread.started")).toHaveLength(1)
  })

  it("prompt 由宿主开轮次，并把 turnId 交给引擎", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })

    const turn = events.find((e) => e.type === "turn.started")
    expect(turn?.type === "turn.started" ? turn.turn.threadId : "").toBe(threadId)
    // 引擎拿到的是宿主铸的那个 turnId，不是自己编的
    expect(session().prompts[0]?.turnId).toBe(turn?.type === "turn.started" ? turn.turn.id : "")
    expect(items(events).some((i) => i.kind === "user_message")).toBe(true)
  })

  it("审批往返：挂卡 → 用户放行 → 卡片转 allowed 且驱动拿到答案", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })

    const answer = session().ask(ask)
    const card = items(events).find((i) => i.kind === "approval")
    expect(card?.kind === "approval" ? card.status : "").toBe("pending")

    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: true,
      remember: "session",
    })
    await expect(answer).resolves.toEqual({ allow: true, remember: "session" })

    const settled = items(events).filter((i) => i.kind === "approval").at(-1)
    expect(settled?.kind === "approval" ? settled.status : "").toBe("allowed")
  })

  it("范围原样传到驱动——压成 boolean 就分不出「这一次」和「这轮对话」", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(ask)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "once" })
    await expect(answer).resolves.toEqual({ allow: true, remember: "once" })
  })

  it("dispose 把挂着的审批按拒绝落定——否则驱动会永远卡在 canUseTool 里", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(ask)

    await host.dispose()
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    expect(session().disposed).toBe(true)
  })

  it("会话状态走完整条链路：running → waiting_approval → running → idle", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    // 开会话本身会补一条 `starting → idle`（见 session.ts 的 create），
    // 这条链路测的是**发消息之后**的状态流转，所以从这里起算
    const base = events.filter((e) => e.type === "thread.updated").length
    const statuses = (): string[] =>
      events
        .filter((e) => e.type === "thread.updated")
        .slice(base)
        .map((e) => e.thread.status)

    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    // 打头那条 `idle` 是这条会话**转正**（临时 → 正式，见 `prompt.ts` 的 `commit`）：
    // 状态本身没变，变的是「它开始算数了」——落盘、进侧栏都从这一刻起
    expect(statuses()).toEqual(["idle", "running"])

    const answer = session().ask(ask)
    expect(statuses()).toEqual(["idle", "running", "waiting_approval"])

    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "once" })
    await answer
    expect(statuses()).toEqual(["idle", "running", "waiting_approval", "running"])

    const turnId = session().prompts[0]?.turnId ?? ""
    session().emit({ type: "turn.completed", at: 0, turnId, status: "completed" })
    expect(statuses()).toEqual(["idle", "running", "waiting_approval", "running", "idle"])
  })

  it("轮次失败时会话落 failed，不是静悄悄回到空闲", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const turnId = session().prompts[0]?.turnId ?? ""
    session().emit({ type: "turn.completed", at: 0, turnId, status: "failed", error: "上游超时" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.status : "").toBe("failed")
  })

  it("未注册的引擎直接报错，不静默建一个坏会话", async () => {
    const { host } = setup()
    await expect(host.dispatch({ ...create, engine: "nope" })).rejects.toThrow("未注册的引擎")
  })

  it("接力到没注册的引擎要报错，不能把会话停在半路", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await expect(host.dispatch({ type: "thread.handoff", threadId, to: "nope" })).rejects.toThrow(
      "未注册的引擎",
    )
  })
})

describe("续跑", () => {
  const setupWithJournal = (): {
    host: Host
    events: Event[]
    session: () => Fake
    stored: Event[]
  } => {
    const stored: Event[] = []
    const { driver, session } = fakeDriver()
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/home/dev",
      emit: (e) => events.push(e),
      newId: (prefix) => {
        counter.n += 1
        return `${prefix}-${String(counter.n)}`
      },
      now: () => 0,
      journal: {
        append: (_id, e) => {
          stored.push(e)
          return Promise.resolve()
        },
        read: () => Promise.resolve(stored),
        list: () => Promise.resolve([]),
        remove: () => Promise.resolve(),
        flush: () => Promise.resolve(),
      },
    })
    return { host, events, session, stored }
  }

  /**
   * **要发过一句话才落盘**：新会话在第一句话之前只攒不写（见 `Ctx.uncommitted`），
   * 所以这里先 prompt 一次再看磁盘。原来的写法是 create 完就查 `stored`，
   * 那同时也把「点一下 + 就往磁盘写一条空会话」钉成了正确行为。
   */
  it("驱动上报的句柄走 thread.updated 落盘——续跑要的东西必须和历史存在同一个地方", async () => {
    const { host, events, session, stored } = setupWithJournal()
    await host.dispatch(create)
    session().handle("codex-thread-abc")
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.engineHandle : "").toBe("codex-thread-abc")
    // 第一句话之前：事件发出去了，磁盘上还没有
    expect(stored.some((e) => e.type === "thread.updated")).toBe(false)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? "th-1"
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "开工" })
    expect(stored.some((e) => e.type === "thread.updated" && e.thread.engineHandle === "codex-thread-abc")).toBe(true)
  })

  it("**一句话都没发的新会话不落盘**——点一下 + 不该在磁盘上留一条空会话", async () => {
    const { host, stored } = setupWithJournal()
    await host.dispatch(create)
    expect(stored).toEqual([])
  })

  it("发了第一句话就整段落盘，顺序照原样（started 在 updated 之前）", async () => {
    const { host, events, stored } = setupWithJournal()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? "th-1"
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "开工" })
    const types = stored.map((e) => e.type)
    expect(types[0]).toBe("thread.started")
    expect(types).toContain("turn.started")
    expect(types.indexOf("thread.started")).toBeLessThan(types.indexOf("turn.started"))
  })

  it("没提交就删掉的会话，攒下的事件一起扔掉，磁盘上一个字都没有", async () => {
    const { host, events, stored } = setupWithJournal()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? "th-1"
    await host.dispatch({ type: "thread.delete", threadId: id })
    expect(stored).toEqual([])
  })

  it("**在会话登记完成之前**到达的句柄也不能丢——codex 在 start() 里就知道自己的 id", async () => {
    const stored: Event[] = []
    const events: Event[] = []
    const holder: { report: ((h: string) => void) | undefined } = { report: undefined }
    const driver: EngineDriver = {
      id: "fake",
      start: (req) => {
        // 冒充 codex：还没返回 session 就先上报句柄
        req.onHandle?.("early-handle")
        holder.report = (h) => req.onHandle?.(h)
        return Promise.resolve({
          threadId: req.threadId,
          prompt: () => Promise.resolve(),
          interrupt: () => Promise.resolve(),
          setTrust: () => Promise.resolve({ restart: false }),
          models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
          setModel: () => Promise.resolve({}),
          dispose: () => Promise.resolve(),
        })
      },
    }
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
      journal: {
        append: (_id, e) => {
          stored.push(e)
          return Promise.resolve()
        },
        read: () => Promise.resolve(stored),
        list: () => Promise.resolve([]),
        remove: () => Promise.resolve(),
        flush: () => Promise.resolve(),
      },
    })
    await host.dispatch(create)
    const last = events.at(-1)
    expect(last?.type === "thread.updated" ? last.thread.engineHandle : "").toBe("early-handle")
    // 顺序必须是 started 打头，反过来落盘里就成了「先更新后创建」。
    // 中间那条 updated 是 `starting → idle`，末尾那条才是补句柄的
    expect(events[0]?.type).toBe("thread.started")
    expect(events.map((e) => e.type).slice(1)).toEqual(["thread.updated", "thread.updated"])
  })

  it("同一个句柄不重复发事件", async () => {
    const { host, events, session } = setupWithJournal()
    await host.dispatch(create)
    // 开会话自带一条 `starting → idle` 的 updated，从这里起算
    const base = events.filter((e) => e.type === "thread.updated").length
    session().handle("h")
    session().handle("h")
    expect(events.filter((e) => e.type === "thread.updated")).toHaveLength(base + 1)
  })

  it("续跑把句柄交给驱动，并把 detached 摘掉", async () => {
    const { host, events, session } = setupWithJournal()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    session().handle("h-1")
    await host.dispose()

    const revived = setupWithJournal()
    // 冒充「上次留下的历史」：把刚才那条带句柄的记录塞进去
    revived.stored.push(...events.filter((e) => e.type === "thread.updated"))
    await revived.host.dispatch({ type: "thread.resume", threadId })
    expect(revived.session().resume).toBe("h-1")
    const last = revived.events.at(-1)
    expect(last?.type === "thread.updated" ? last.thread.detached : true).toBe(false)
  })

  it("没有句柄就拒绝续跑——起一个全新会话却看着像接上了，是最坏的结果", async () => {
    const { host, stored } = setupWithJournal()
    stored.push({
      type: "thread.started",
      at: 0,
      thread: {
        id: "th-x",
        title: "旧",
        cwd: "/w",
        engine: "fake",
        trust: "auto-edit",
        status: "idle",
        createdAt: 0,
        updatedAt: 0,
        engineHistory: ["fake"],
      },
    })
    await expect(host.dispatch({ type: "thread.resume", threadId: "th-x" })).rejects.toThrow("句柄")
  })

  it("历史里没有这个会话就报错，不静默新建", async () => {
    const { host } = setupWithJournal()
    await expect(host.dispatch({ type: "thread.resume", threadId: "unknown" })).rejects.toThrow("找不到")
  })

  it("已经活着的会话再点续跑是无操作", async () => {
    const { host, events } = setupWithJournal()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    const before = events.length
    await host.dispatch({ type: "thread.resume", threadId })
    expect(events).toHaveLength(before)
  })
})

describe("删除会话", () => {
  it("先落定审批、再 dispose、最后删文件——反过来会留下一个卡住的驱动和一个删不掉的文件", async () => {
    const removed: string[] = []
    const stored: Event[] = []
    const { driver, session } = fakeDriver()
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
      journal: {
        append: (_id, e) => {
          stored.push(e)
          return Promise.resolve()
        },
        read: () => Promise.resolve(stored),
        list: () => Promise.resolve([]),
        remove: (id) => {
          // 删文件时驱动必须已经处置完
          expect(session().disposed).toBe(true)
          removed.push(id)
          return Promise.resolve()
        },
        flush: () => Promise.resolve(),
      },
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(ask)

    await host.dispatch({ type: "thread.delete", threadId })
    expect(removed).toEqual([threadId])
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    expect(events.at(-1)).toEqual({ type: "thread.removed", at: 0, threadId })
  })

  it("删一个只在磁盘上的会话（宿主没登记）同样有效", async () => {
    const removed: string[] = []
    const { driver } = fakeDriver()
    const events: Event[] = []
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => `${p}-1`,
      now: () => 0,
      journal: {
        append: () => Promise.resolve(),
        read: () => Promise.resolve([]),
        list: () => Promise.resolve([]),
        remove: (id) => {
          removed.push(id)
          return Promise.resolve()
        },
        flush: () => Promise.resolve(),
      },
    })
    await host.dispatch({ type: "thread.delete", threadId: "th-from-disk" })
    expect(removed).toEqual(["th-from-disk"])
  })
})

describe("审批记忆", () => {
  const setupRules = (): {
    host: Host
    events: Event[]
    session: () => Fake
    saved: { worksite: string; id: string; scope: string }[]
    seed: StoredRule[]
  } => {
    const saved: { worksite: string; id: string; scope: string }[] = []
    const seed: StoredRule[] = []
    const { driver, session } = fakeDriver()
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
      rules: {
        read: () => Promise.resolve(seed),
        add: (worksite, r) => {
          saved.push({ worksite, id: r.id, scope: r.scope })
          return Promise.resolve([r])
        },
        remove: () => Promise.resolve([]),
      },
    })
    return { host, events, session, saved, seed }
  }

  const suggested = { id: "sig:pnpm test", describe: "自动允许 pnpm test", pattern: {}, scope: "project" as const }

  const askWith = { ...ask, suggest: suggested }

  it("开会话时把工作区已有的规则读进来交给驱动", async () => {
    const { host, seed, session } = setupRules()
    seed.push({ id: "old", describe: "旧规则", pattern: {}, scope: "project" })
    await host.dispatch(create)
    expect(session().memory().map((r) => r.id)).toEqual(["old"])
  })

  it("勾了「始终允许」才写盘", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "project" })
    await answer
    expect(saved).toEqual([{ worksite: "/w", id: "sig:pnpm test", scope: "project" }])
  })

  it("「允许此对话」只进内存不写盘——落盘会让下次启动莫名其妙少几次询问", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "session" })
    await answer
    expect(saved).toEqual([])
    // 但**立刻**对后续判定生效——所以 memory 是取值函数不是快照
    expect(session().memory().map((r) => r.id)).toEqual(["sig:pnpm test"])
  })

  it("拒绝不记忆——记住一次拒绝没有意义，下次同样的请求还是该问", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: false, remember: "project" })
    await answer
    expect(saved).toEqual([])
    expect(session().memory()).toEqual([])
  })

  it("remember:'once' 什么都不留", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "once" })
    await answer
    expect(saved).toEqual([])
    expect(session().memory()).toEqual([])
  })
})

/** 两家引擎的宿主。接力与分叉两节共用。 */
const setupTwoEngines = (): { host: Host; events: Event[]; sessions: Fake[]; stored: Event[] } => {
    const stored: Event[] = []
    const sessions: Fake[] = []
    const driver = (id: string): EngineDriver => ({
      id,
      start: (req) => {
        const fake: Fake = {
          prompts: [],
          disposed: false,
          ask: req.askUser,
          emit: req.emit,
          resume: req.resume,
          handle: (h) => req.onHandle?.(h),
          drift: (model, effort) => req.onModel?.(model, effort),
          report: (patch) => req.onEngineState?.(patch),
          memory: req.memory,
        }
        sessions.push(fake)
        return Promise.resolve({
          threadId: req.threadId,
          prompt: (text, turnId) => {
            fake.prompts.push({ text, turnId })
            return Promise.resolve()
          },
          interrupt: () => Promise.resolve(),
          setTrust: () => Promise.resolve({ restart: false }),
          models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
          setModel: () => Promise.resolve({}),
          dispose: () => {
            fake.disposed = true
            return Promise.resolve()
          },
        })
      },
    })
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver("fake"), other: driver("other") },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
      journal: {
        append: (_id, e) => {
          stored.push(e)
          return Promise.resolve()
        },
        read: () => Promise.resolve(stored),
        list: () => Promise.resolve([]),
        remove: () => Promise.resolve(),
        flush: () => Promise.resolve(),
      },
    })
  return { host, events, sessions, stored }
}

describe("跨引擎接力", () => {
  const setupTwo = setupTwoEngines

  /**
   * 切引擎 + 发出下一句。两件事在新设计里是分开的：
   *
   * - 点下拉只记一笔 `nextEngine`（见 `Thread.nextEngine`），什么都不动；
   * - **真正的切换发生在下一句话发出去的那一刻**。
   *
   * 中间那条 `turn.completed` 不是凑数：**上一轮还没跑完时不切引擎**——
   * 那时新说的话会排队，切换要等队列被 drain 才发生。
   */
  const handoffTo = async (rig: ReturnType<typeof setupTwoEngines>, to: string): Promise<string> => {
    const threadId = await worked(rig)
    await rig.host.dispatch({ type: "thread.handoff", threadId, to })
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    return threadId
  }

  /**
   * 让这条会话**开过工**：发一句话（它就此从临时会话转正）再让那一轮收工。
   *
   * 「下一句生效」那套规则只对开过工的会话成立——还没说过话的临时会话
   * 切引擎是当场切的（见 `Thread.provisional`），所以每条测它的用例
   * 都得先走这一步，否则测的是另一条路。
   */
  /** 起一个只挂这些驱动的宿主。下面几条用例各要一种特殊驱动（起不来的、报模型的、报能力的）。 */
  const hostWith = (drivers: Record<string, EngineDriver>): { host: Host; events: Event[] } => {
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers,
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
    })
    return { host, events }
  }

  /** 一个只报「我叫什么、我能干什么、我有哪些模型」的驱动。 */
  const stub = (id: string, caps: Partial<{ attachments: boolean }> = {}): EngineDriver => ({
    id,
    start: (req) =>
      Promise.resolve({
        threadId: req.threadId,
        prompt: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([{ id: `${id}-model`, label: id }]),
        capabilities: () => ({ ...NO_CAPABILITIES, ...caps }),
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      } as unknown as EngineSession),
  })

  const worked = async (rig: ReturnType<typeof setupTwoEngines>): Promise<string> => {
    const { host, events, sessions } = rig
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    const first = sessions[0]
    first?.emit({ type: "turn.completed", at: 0, turnId: first.prompts[0]?.turnId ?? "", status: "completed" })
    return threadId
  }

  it("先停旧的再起新的——两个引擎同时对着一个工作区写是最难查的冲突", async () => {
    const rig = setupTwo()
    const { host, sessions } = rig
    await host.dispatch(create)
    await handoffTo(rig, "other")
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    expect(sessions[1]?.disposed).toBe(false)
  })

  /**
   * **不塞任何文本。** 上一版把 omni 提炼的一段话挂成草稿等用户按回车——
   * 用户否掉了：那是他没打过的话，而历史对话新的引擎自己会读
   *（路径在 `Thread.segments` 里，`/timeline` 看得见）。
   */
  it("**输入框里一个字都不塞**——用户自己那句话直接进新引擎", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    const threadId = await handoffTo(rig, "other")
    const drafts = events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === threadId)
      .map((e) => e.thread.draft)
    expect(drafts.every((d) => d === undefined)).toBe(true)
    // 换过去之后他说的那句话原样送到新那家，没有任何 omni 编的前言
    expect((sessions[1]?.prompts ?? []).map((x) => x.text)).toEqual(["接着弄"])
  })

  /**
   * **选了不等于开始用。** 点下拉只记一笔 `nextEngine`：旧进程不停、
   * 新进程不起、模型不清——那一串副作用发生在用户还什么都没说的时候，
   * 看起来就是莫名其妙地变了。
   */
  it("开过工的会话：只点下拉不说话，什么都没变，旧引擎还活着", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.disposed).toBe(false)
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.engine).toBe("fake")
    expect(thread?.nextEngine).toBe("other")
    expect(thread?.engineHistory).toEqual(["fake"])
  })

  /**
   * 「下一句生效」的那个副作用：**换过去之前挑不了新那家的模型**——
   * 清单是引擎起来之后自己报的。所以给一条显式的路，不改默认。
   */
  it("`switchNow`：把已经记下的那笔意向**立刻兑现**", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.switchNow", threadId })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.engine).toBe("other")
    expect(thread?.nextEngine).toBeUndefined()
  })

  it("没有待切换的时候 `switchNow` 什么都不做——它兑现意向，不制造意向", async () => {
    const rig = setupTwo()
    const { host, sessions } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.switchNow", threadId })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.disposed).toBe(false)
  })

  it("选回当前那家 = 取消待切换", async () => {
    const rig = setupTwo()
    const { host, events } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.handoff", threadId, to: "fake" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.nextEngine : "x").toBeUndefined()
  })

  /**
   * **临时会话反过来：当场切。**
   *
   * 它还什么都没说——没有正在跑的活、没有要保住的上下文，「点错了」的代价是零。
   * 而推迟有个实打实的代价：模型清单要引擎起来才报，不当场切就等于
   * 「你得先说一句话，才能挑这一句用哪个模型」。
   */
  it("**还没说过话的会话：当场切**——新那家起来了，旧那家停了", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.engine).toBe("other")
    expect(thread?.nextEngine).toBeUndefined()
    // 还是临时的：切引擎不算「说过话」
    expect(thread?.provisional).toBe(true)
    // **旧那家什么都没发生过，历史里不留一笔**——挑三次就记三条的话，
    // 时间线会被「我点错了」填满
    expect(thread?.engineHistory).toEqual(["other"])
  })

  /**
   * **起不来就原样退回。** 上一版是先 dispose 旧的再 launch 新的，于是
   * 新那家起不来（没装、没登录、版本不对——引擎下拉里那些标着「未安装」的
   * 仍然可选，故意的）时旧进程也已经没了：**那条会话从此发不出任何一句话**，
   * 而界面上看不出为什么。
   */
  it("**新那家起不来就原样退回**——旧那家还活着，下一句照样发得出去", async () => {
    const { driver, session } = fakeDriver()
    const { host, events } = hostWith({
      fake: driver,
      bad: { id: "bad", start: () => Promise.reject(new Error("没装")) },
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await expect(host.dispatch({ type: "thread.handoff", threadId, to: "bad" })).rejects.toThrow("没装")
    expect(session().disposed).toBe(false)
    await host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    expect(session().prompts.map((p) => p.text)).toEqual(["接着弄"])
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.engine : "").toBe("fake")
  })

  /**
   * 模型清单**带着报它的那家一起走**。不带的话，切过去而新那家一个模型都报不上来时
   * （`models()` 失败就是空数组，那时宿主什么都不发），界面上留着的是上一家的清单
   * ——点一下就拿 claude 的模型 id 去设给 codex。
   */
  it("模型清单报的是哪一家，事件里说得出来", async () => {
    const { host, events } = hostWith({ fake: stub("fake"), other: stub("other") })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await new Promise((done) => setTimeout(done, 5))
    const reported = events
      .filter((e) => e.type === "models.updated")
      .map((e) => (e.type === "models.updated" ? [e.engine, e.models.map((m) => m.id).join()] : []))
    expect(reported).toEqual([
      ["fake", "fake-model"],
      ["other", "other-model"],
    ])
  })

  /**
   * **换过去之后界面看到的能力是新那家的。**
   *
   * 上一版发的是局部那份 thread（`launch` 之前拼好的），而引擎能力是 `launch`
   * 期间挂到 `live` 上的——于是换过去之后，贴图入口、改向提示照着**上一家**画。
   * `create` 那边为同一个坑留过一行注释，这条路当初漏了。
   */
  it("换过去之后，界面拿到的是**新那家**的能力", async () => {
    const { host, events } = hostWith({
      fake: stub("fake", { attachments: true }),
      other: stub("other", { attachments: false }),
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.capabilities?.attachments : "没有").toBe(false)
  })

  it("临时会话切过引擎之后，第一句话发给的是新那家", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "开工" })
    expect((sessions[1]?.prompts ?? []).map((p) => p.text)).toEqual(["开工"])
    expect(sessions[0]?.prompts ?? []).toHaveLength(0)
  })

  it("会话 id 不变，引擎历史往后接一手", async () => {
    const rig = setupTwo()
    const { host, events } = rig
    await host.dispatch(create)
    const threadId = await handoffTo(rig, "other")
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.id).toBe(threadId)
    expect(thread?.engineHistory).toEqual(["fake", "other"])
  })

  it("**旧引擎的会话句柄要清掉**——留着的话续跑会拿它去问新的一家", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    sessions[0]?.handle("old-handle")
    await handoffTo(rig, "other")
    const updates = events.filter((e) => e.type === "thread.updated")
    const afterHandoff = updates.at(-1)
    const thread = afterHandoff?.type === "thread.updated" ? afterHandoff.thread : undefined
    expect(thread?.engineHandle).not.toBe("old-handle")
  })

  it("接力到自己是无操作——不该白白重启一次引擎", async () => {
    const rig = setupTwo()
    const { host, sessions } = rig
    await host.dispatch(create)
    await handoffTo(rig, "fake")
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.disposed).toBe(false)
  })
})

describe("L3 分叉", () => {
  it("原会话不停——这是分叉和接力唯一的区别", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    expect(sessions[0]?.disposed).toBe(false)
    expect(sessions).toHaveLength(2)
  })

  it("新会话是新 id、新引擎历史——不是同一个会话换了家", async () => {
    const { host, events } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "目标" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    const started = events.filter((e) => e.type === "thread.started")
    expect(started).toHaveLength(2)
    const forked = started[1]?.type === "thread.started" ? started[1].thread : undefined
    expect(forked?.id).not.toBe(threadId)
    expect(forked?.engineHistory).toEqual(["other"])
  })

  it("分叉出来的那条**一句都没发、一个字都没塞**", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    expect(sessions[1]?.prompts ?? []).toEqual([])
    const forked = events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    const drafts = events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === forked)
      .map((e) => e.thread.draft)
    expect(drafts.every((d) => d === undefined)).toBe(true)
  })

  it("标题带上引擎名，否则侧栏里两个会话长得一模一样", async () => {
    const { host, events } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "目标" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    const started = events.filter((e) => e.type === "thread.started")
    const forked = started[1]?.type === "thread.started" ? started[1].thread : undefined
    expect(forked?.title).toContain("other")
  })
})

/**
 * 起引擎慢的那类驱动。真实的 codex 是 400ms——不长，但**不是零**，
 * 而界面必须在这 400ms 里已经有东西了。
 */
function slowDriver(delayMs: number, fail = false): EngineDriver {
  return {
    id: "slow",
    start: async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      if (fail) throw new Error("引擎起不来")
      return {
        threadId: "t",
        prompt: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        askAside: (text: string) => Promise.resolve(`答：${text}`),
        capabilities: () => NO_CAPABILITIES,
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      }
    },
  }
}

function slowSetup(delayMs: number, fail = false): { host: Host; events: Event[]; starts: () => number } {
  const events: Event[] = []
  const counter = { n: 0, starts: 0 }
  const inner = slowDriver(delayMs, fail)
  const driver: EngineDriver = {
    id: "slow",
    start: (req) => {
      counter.starts += 1
      return inner.start(req)
    },
  }
  const host = createHost({
    drivers: { slow: driver },
    home: "/home/dev",
    emit: (e) => events.push(e),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => 0,
  })
  return { host, events, starts: () => counter.starts }
}

const slowCreate = { type: "thread.create", cwd: "/w", engine: "slow", trust: "auto-edit" } as const

describe("新建会话：先出现，再起引擎", () => {
  it("**引擎还没起完，会话就已经在事件流里了**——不然点下去几百毫秒毫无反应", async () => {
    const { host, events } = slowSetup(120)
    const pending = host.dispatch(slowCreate)
    // 不等它跑完就看
    await new Promise((r) => setTimeout(r, 30))
    const started = events.find((e) => e.type === "thread.started")
    expect(started?.type === "thread.started" ? started.thread.status : "").toBe("starting")
    await pending
  })

  it("引擎起好之后补一条 idle", async () => {
    const { host, events } = slowSetup(20)
    await host.dispatch(slowCreate)
    const updated = [...events].reverse().find((e) => e.type === "thread.updated")
    expect(updated?.type === "thread.updated" ? updated.thread.status : "").toBe("idle")
  })

  it("**引擎起不来就把那一行撤掉**——留一个永远 starting 的空壳比没有更糟", async () => {
    const { host, events } = slowSetup(10, true)
    await expect(host.dispatch(slowCreate)).rejects.toThrow("引擎起不来")
    expect(events.filter((e) => e.type === "thread.removed")).toHaveLength(1)
  })
})

describe("在途去重", () => {
  it("**连点三下只起一个引擎**——实测点三下真的会 spawn 三个 codex", async () => {
    const { host, starts } = slowSetup(60)
    await Promise.all([host.dispatch(slowCreate), host.dispatch(slowCreate), host.dispatch(slowCreate)])
    expect(starts()).toBe(1)
  })

  it("上一次落定之后再建是允许的——**同一个目录开第二个会话是合法用法**", async () => {
    const { host, starts } = slowSetup(10)
    await host.dispatch(slowCreate)
    await host.dispatch(slowCreate)
    expect(starts()).toBe(2)
  })

  it("参数不同的不算重入：换个档位就是另一个请求", async () => {
    const { host, starts } = slowSetup(60)
    await Promise.all([
      host.dispatch(slowCreate),
      host.dispatch({ ...slowCreate, trust: "read-only" }),
    ])
    expect(starts()).toBe(2)
  })

  it("**失败也要放行**，否则一次失败就把这个键永久锁死", async () => {
    const { host, starts } = slowSetup(10, true)
    await expect(host.dispatch(slowCreate)).rejects.toThrow()
    await expect(host.dispatch(slowCreate)).rejects.toThrow()
    expect(starts()).toBe(2)
  })

  it("**上一轮跑完之后**再发是允许的——去重表不该把正常的追问也拦掉", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const first = events.find((e) => e.type === "thread.started")
    const threadId = first?.type === "thread.started" ? first.thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "一" })
    const turnId = session().prompts[0]?.turnId ?? ""
    session().emit({ type: "turn.completed", at: 0, turnId, status: "completed" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "二" })
    expect(session().prompts.map((p) => p.text)).toEqual(["一", "二"])
  })

  it("**上一轮还在跑就不开新轮次**——覆盖 entry.turn 的话，引擎还在往旧 turnId 上发 item，正在流的回答会整个消失", async () => {
    // 硬约束没变，变的是没跑完时怎么办：以前抛错，现在排队（见「跑着的时候补一句话」那组）。
    // 这里钉的是那条硬约束本身：**第二句不能变成第二个 turn**
    const { host, events, session } = setup()
    await host.dispatch(create)
    const first = events.find((e) => e.type === "thread.started")
    const threadId = first?.type === "thread.started" ? first.thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "一" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "二" })
    expect(session().prompts).toHaveLength(1)
    expect(events.filter((e) => e.type === "turn.started")).toHaveLength(1)
  })
})

describe("改名", () => {
  it("发出 thread.renamed", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.rename", threadId: id, title: "改分页那个" })
    expect(events.filter((e) => e.type === "thread.renamed")).toHaveLength(1)
  })

  it("**不在内存里的会话也能改**——历史会话才是最需要改名的那批", async () => {
    const { host, events } = setup()
    await host.dispatch({ type: "thread.rename", threadId: "th-只在磁盘上", title: "旧账" })
    expect(events.find((e) => e.type === "thread.renamed")).toMatchObject({
      threadId: "th-只在磁盘上",
      title: "旧账",
    })
  })

  it("空名字不发事件——侧栏那一行会变成一块什么都不写的空白", async () => {
    const { host, events } = setup()
    await host.dispatch({ type: "thread.rename", threadId: "th-1", title: "   " })
    expect(events.filter((e) => e.type === "thread.renamed")).toHaveLength(0)
  })

  it("首尾空格剪掉", async () => {
    const { host, events } = setup()
    await host.dispatch({ type: "thread.rename", threadId: "th-1", title: "  两头有空格  " })
    expect(events.find((e) => e.type === "thread.renamed")).toMatchObject({ title: "两头有空格" })
  })

  it("改完之后 live 里那份也是新名字——不然接力/分叉会带着旧标题走", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.rename", threadId: id, title: "新名字" })
    expect(host.live().find((t) => t.id === id)?.title).toBe("新名字")
  })
})

describe("中断之后审批卡不能还挂着", () => {
  it("**中断时把待确认的审批落定**——否则事后点「允许」会写进永久规则，而那次调用早作废了", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "跑一下" })
    const pending = session().ask(ask)
    await new Promise((r) => setTimeout(r, 0))
    await host.dispatch({ type: "thread.interrupt", threadId: id })
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    session().emit({ type: "turn.completed", at: 1, turnId, status: "interrupted" })
    await new Promise((r) => setTimeout(r, 0))
    // 挂着的那次审批必须已经落定（按拒绝），驱动不会永远等在 canUseTool 里
    await expect(pending).resolves.toMatchObject({ allow: false })
  })

  it("正常跑完不动审批卡——那时候没有挂着的，扫一遍也不该有副作用", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "跑一下" })
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await new Promise((r) => setTimeout(r, 0))
    expect(host.live().find((t) => t.id === id)?.status).toBe("idle")
  })
})

describe("跑着的时候补一句话：排队，不是拒绝", () => {
  const run = async (): Promise<{ host: Host; events: Event[]; session: () => Fake; id: string; turnId: string }> => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    return { host, events, session, id, turnId }
  }

  it("上一轮还在跑时再发一句，**不报错**，进队列", async () => {
    const { host, events, id } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.thread.queued).toEqual(["补一句"])
  })

  it("这一轮跑完，排队那句自动发出去", async () => {
    const { host, session, id, turnId } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await new Promise((r) => setTimeout(r, 0))
    expect(session().prompts.map((p) => p.text)).toEqual(["第一句", "补一句"])
  })

  it("**一次只发一句**：跑完发第二句，第三句还在队里等", async () => {
    const { host, events, session, id, turnId } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "再补一句" })
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await new Promise((r) => setTimeout(r, 0))
    expect(session().prompts.map((p) => p.text)).toEqual(["第一句", "补一句"])
    expect(events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual(["再补一句"])
  })

  it("**按停止就把队列作废**——「停完这句再跑下一句」不是任何人按停止时想要的", async () => {
    const { host, events, session, id } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    await host.dispatch({ type: "thread.interrupt", threadId: id })
    expect(events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([])
    expect(session().prompts).toHaveLength(1)
  })

  it("中断结束的轮次不会把队列接着发出去", async () => {
    const { host, session, id, turnId } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    session().emit({ type: "turn.completed", at: 1, turnId, status: "interrupted" })
    await new Promise((r) => setTimeout(r, 0))
    expect(session().prompts).toHaveLength(1)
  })
})

describe("跑着的时候补一句话：默认排队，插入是明确动作", () => {
  /**
   * 会 steer 的假引擎。**和上面那个共用不了**：它要能记下 steer 收到了什么、
   * 还要能让 steer 主动失败（那条竞态分支只有这样才测得到）。
   */
  const steerable = (): {
    host: Host
    events: Event[]
    steered: { text: string; attachments?: readonly string[] }[]
    prompts: { text: string }[]
    fail: { now: boolean }
  } => {
    const events: Event[] = []
    const steered: { text: string; attachments?: readonly string[] }[] = []
    const prompts: { text: string }[] = []
    const fail = { now: false }
    const counter = { n: 0 }
    const host = createHost({
      drivers: {
        fake: {
          id: "fake",
          start: (req) =>
            Promise.resolve({
              threadId: req.threadId,
              prompt: (text: string) => {
                prompts.push({ text })
                return Promise.resolve()
              },
              steer: (text: string, attachments?: readonly string[]) => {
                if (fail.now) return Promise.reject(new Error("那一轮刚好收工了"))
                steered.push({ text, ...(attachments === undefined ? {} : { attachments }) })
                return Promise.resolve()
              },
              interrupt: () => Promise.resolve(),
              setTrust: () => Promise.resolve({ restart: false }),
              models: () => Promise.resolve([]),
              capabilities: () => ({ compact: false, attachments: true, steer: true }),
              setModel: () => Promise.resolve({}),
              dispose: () => Promise.resolve(),
            } as unknown as EngineSession),
        },
      },
      home: "/home/dev",
      emit: (e) => events.push(e),
      newId: (prefix) => {
        counter.n += 1
        return `${prefix}-${String(counter.n)}`
      },
      now: () => 0,
    })
    return { host, events, steered, prompts, fail }
  }

  const running = async (h: ReturnType<typeof steerable>): Promise<string> => {
    await h.host.dispatch(create)
    const id = h.events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    return id
  }

  /**
   * **默认排队，哪怕引擎会 steer。** 这一条是和 codex 自己的行为对齐：
   * 在它的界面里打字回车那句是排着的，要再点一下才插进去。
   * 反过来（能插就插）的后果不是别扭，是「你以为在排队的那句，
   * 其实已经改变了它正在做的事」。
   */
  it("默认**进队列**，不碰正在跑的那一轮——即使引擎支持 steer", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "不对，用另一个文件" })
    expect(h.steered).toHaveLength(0)
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([
      "不对，用另一个文件",
    ])
  })

  it("带 `steer` 才当场递进去（⌘⏎ 那条路）", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "不对，用另一个文件", steer: true })
    expect(h.steered.map((s) => s.text)).toEqual(["不对，用另一个文件"])
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued ?? []).toEqual([])
  })

  it("排队条上的「立刻插入」：把排着的几句合成一段递进去，**成功之后才清队列**", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "先别写" })
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "改用另一个文件" })
    await h.host.dispatch({ type: "thread.steerQueued", threadId: id })
    expect(h.steered.map((s) => s.text)).toEqual(["先别写\n改用另一个文件"])
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([])
  })

  it("「立刻插入」失败时**队列原样留着**——那几句往往正是「别再往下走了」，丢不得", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "别再往下走了" })
    h.fail.now = true
    await h.host.dispatch({ type: "thread.steerQueued", threadId: id })
    expect(h.steered).toHaveLength(0)
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([
      "别再往下走了",
    ])
  })

  it("**不开新轮次**——开了的话引擎还在往旧 turnId 上发 item，正在流的回答会整个消失", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    expect(h.events.filter((e) => e.type === "turn.started")).toHaveLength(1)
  })

  it("插进去的那句挂在**当前这一轮**上：transcript 里就该出现在它实际插话的位置", async () => {
    const h = steerable()
    const id = await running(h)
    const turnId = h.events.find((e) => e.type === "turn.started")?.turn.id
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句", steer: true })
    const said = items(h.events).filter((i) => i.kind === "user_message")
    expect(said.map((i) => i.text)).toEqual(["第一句", "补一句"])
    expect(said[1]?.turnId).toBe(turnId)
  })

  it("附件跟着一起递过去", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "看这张",
      attachments: ["/tmp/a.png"],
      steer: true,
    })
    expect(h.steered[0]?.attachments).toEqual(["/tmp/a.png"])
  })

  it("**递不进去就退回排队**，不报错——主因是那一轮刚好收工，而队列会立刻把它发出去", async () => {
    const h = steerable()
    const id = await running(h)
    h.fail.now = true
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句", steer: true })
    expect(h.steered).toHaveLength(0)
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual(["补一句"])
  })

  it("**递不进去时不留下幽灵消息**：先 steer 再发 item，顺序反了就会「你以为说过了」", async () => {
    const h = steerable()
    const id = await running(h)
    h.fail.now = true
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "没送出去的那句", steer: true })
    expect(items(h.events).filter((i) => i.kind === "user_message").map((i) => i.text)).toEqual(["第一句"])
  })

  it("没在跑的时候照常开新轮次，不走 steer", async () => {
    const h = steerable()
    await h.host.dispatch(create)
    const id = h.events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    expect(h.prompts.map((p) => p.text)).toEqual(["第一句"])
    expect(h.steered).toHaveLength(0)
  })
})

describe("换模型时的推理强度", () => {
  const pick = async (): Promise<{ host: Host; events: Event[]; id: string }> => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "high" })
    return { host, events, id }
  }
  const effortOf = (events: Event[]): string | undefined =>
    events.filter((e) => e.type === "thread.updated").at(-1)?.thread.effort

  it("选了就记下", async () => {
    const { events } = await pick()
    expect(effortOf(events)).toBe("high")
  })

  it("**引擎拒了那一档时，记下的是引擎还在用的那个**——不是你点的那个", async () => {
    // 实测 ZCode：桥把 `thought` 报成可选，设进去必然 Internal error。
    // 那一步失败不算换模型失败（模型确实换了），但记录里要是请求值的话，
    // 输入区会显示「轻度」而引擎在 max——**界面在说一件没发生的事**
    const { host, events } = setup({ effort: () => ({ effort: "max" }) })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "low" })
    expect(effortOf(events)).toBe("max")
  })

  it("**换到不报强度的模型时要清掉**——留着的话界面会画一个引擎根本没在用的档位", async () => {
    const { host, events, id } = await pick()
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "b" })
    expect(effortOf(events)).toBeUndefined()
  })
})

/**
 * 换模型有两个发起方：用户点下拉，和 **agent 自己换**。
 * 后者以前只走到 `models.updated`——那条换的是**清单**，不是**选中项**，
 * 于是清单更新了而 `Thread.model` 还是旧值，输入区照着它画一个引擎已经不在跑的模型。
 */
describe("agent 自己换了模型", () => {
  const start = async (): Promise<{ events: Event[]; session: () => Fake; id: string }> => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "high" })
    return { events, session, id }
  }
  const last = (events: Event[]) => events.filter((e) => e.type === "thread.updated").at(-1)?.thread

  it("引擎报上来的新模型要落到会话记录上", async () => {
    const { events, session } = await start()
    session().drift("b", "low")
    expect(last(events)?.model).toBe("b")
    expect(last(events)?.effort).toBe("low")
  })

  it("**没报的那一项不动原值**——「引擎没报」不等于「引擎报了个空」", async () => {
    const { events, session } = await start()
    session().drift("b", undefined)
    expect(last(events)?.model).toBe("b")
    // 用户选过的 high 不该被这条只带模型的通知悄悄清掉
    expect(last(events)?.effort).toBe("high")
  })

  it("跟原值一样就不发事件——一条什么都没变的 `thread.updated` 只会让界面白重画", async () => {
    const { events, session } = await start()
    const before = events.filter((e) => e.type === "thread.updated").length
    session().drift("a", "high")
    expect(events.filter((e) => e.type === "thread.updated").length).toBe(before)
  })
})

describe("活会话上限：闲着的先收掉", () => {
  /**
   * 一个 codex 会话实测 260 MB / 4 个进程，不设上限开五条就是 1.3 GB，
   * 而且全闲着。这里钉的是「收谁」和「绝不收谁」——后者更要紧。
   */
  const rig = (
    maxLive: number,
  ): { host: Host; events: Event[]; disposed: string[]; emit: (id: string, e: Event) => void } => {
    const events: Event[] = []
    const disposed: string[] = []
    const emitters = new Map<string, (e: Event) => void>()
    const counter = { n: 0 }
    const host = createHost({
      drivers: {
        fake: {
          id: "fake",
          start: (req) => {
            // 报个句柄，不然按规则它不该被收（收了回不来）
            req.onHandle?.(`cx-${req.threadId}`)
            emitters.set(req.threadId, req.emit)
            return Promise.resolve({
              threadId: req.threadId,
              prompt: () => Promise.resolve(),
              interrupt: () => Promise.resolve(),
              setTrust: () => Promise.resolve({ restart: false }),
              models: () => Promise.resolve([]),
              capabilities: () => NO_CAPABILITIES,
              setModel: () => Promise.resolve({}),
              dispose: () => {
                disposed.push(req.threadId)
                return Promise.resolve()
              },
            } as unknown as EngineSession)
          },
        },
      },
      home: "/home/dev",
      maxLive,
      emit: (e) => events.push(e),
      newId: (prefix) => {
        counter.n += 1
        return `${prefix}-${String(counter.n)}`
      },
      now: () => counter.n,
    })
    return { host, events, disposed, emit: (id, e) => emitters.get(id)?.(e) }
  }

  /**
   * 开一条会话，**发一句话让它转正，再让那一轮收工**。
   *
   * 三步缺一不可：一句话都没说的是临时会话，建下一条时本来就会被收掉
   *（见 `session.ts` 的 `dropTemps`），根本轮不到上限这条规则；
   * 而不收工的话它永远「正在跑」，那是另一条规则（正在跑的绝不收）。
   */
  const open = async (r: ReturnType<typeof rig>): Promise<string> => {
    await r.host.dispatch(create)
    const id = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "hi" })
    const turnId = r.events.filter((e) => e.type === "turn.started").at(-1)?.turn.id ?? ""
    r.emit(id, { type: "turn.completed", at: 0, turnId, status: "completed" })
    return id
  }

  it("没到上限不收任何东西", async () => {
    const r = rig(3)
    await open(r)
    await open(r)
    expect(r.disposed).toEqual([])
  })

  it("**超了就收最久没动的那个**", async () => {
    const r = rig(2)
    const first = await open(r)
    await open(r)
    await open(r)
    expect(r.disposed).toEqual([first])
  })

  it("收掉的标成 detached——界面上就是「点继续接回引擎」，那条路本来就有", async () => {
    const r = rig(2)
    const first = await open(r)
    await open(r)
    await open(r)
    const last = r.events.filter((e) => e.type === "thread.updated").filter((e) => e.thread.id === first).at(-1)
    expect(last?.thread.detached).toBe(true)
  })

  it("**记录不删**：收起来不是删掉，日志和句柄都还在", async () => {
    const r = rig(2)
    const first = await open(r)
    await open(r)
    await open(r)
    expect(r.events.some((e) => e.type === "thread.removed" && e.threadId === first)).toBe(false)
    const last = r.events.filter((e) => e.type === "thread.updated").filter((e) => e.thread.id === first).at(-1)
    expect(last?.thread.engineHandle).toBeDefined()
  })

  it("**正在跑的绝不收**——收掉等于中断用户的活", async () => {
    const r = rig(2)
    const first = await open(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: first, text: "跑着呢" })
    await open(r)
    await open(r)
    expect(r.disposed).not.toContain(first)
  })

  it("上限内没有可收的就不收，宁可超一点也不动正在跑的", async () => {
    const r = rig(1)
    const first = await open(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: first, text: "跑着呢" })
    await open(r)
    expect(r.disposed).toEqual([])
  })
})

/**
 * 临时会话：**发出第一句话才算数**。
 *
 * 点一下「+」（以及 omni 启动时自动开的那条）先给的是一个临时窗口——
 * 引擎照起（模型清单、斜杠命令都要它才有），但它不进侧栏、不落盘。
 * 「不进侧栏」是渲染层的事，这里钉的是它下面那条契约：`Thread.provisional`
 * 什么时候立、什么时候清、以及没人要的那条怎么收场。
 */
describe("临时会话：发出第一句话才算数", () => {
  const idOf = (events: Event[], at = 0): string => {
    const started = events.filter((e) => e.type === "thread.started")[at]
    return started?.type === "thread.started" ? started.thread.id : ""
  }

  it("新建出来就是临时的", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const started = events.find((e) => e.type === "thread.started")
    expect(started?.type === "thread.started" ? started.thread.provisional : undefined).toBe(true)
  })

  it("**发出第一句话就转正**，而且转正那条排在 turn.started 前面（落盘顺序靠它）", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    await host.dispatch({ type: "thread.prompt", threadId: idOf(events), text: "开工" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.provisional : "还在").toBeUndefined()
    const types = events.map((e) => e.type)
    const turned = events.findIndex((e) => e.type === "thread.updated" && e.thread.provisional === undefined)
    expect(turned).toBeLessThan(types.indexOf("turn.started"))
  })

  /**
   * **再点一次「+」，上一条临时会话就收掉。**
   *
   * 它不在侧栏里，所以一旦你又点了一次「+」或者切去别的会话，它就再也点不回来了
   * ——而背后那个引擎进程还活着（实测一条 codex 会话 260 MB）。
   * 看不见又回不去的东西不该继续占着进程。
   */
  it("**建下一条临时会话时，上一条被收掉**", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const first = idOf(events)
    await host.dispatch(create)
    expect(sessions[0]?.disposed).toBe(true)
    expect(events.some((e) => e.type === "thread.removed" && e.threadId === first)).toBe(true)
    expect(sessions[1]?.disposed).toBe(false)
  })

  it("**开过工的会话不收**——它已经是一条真会话了", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const first = idOf(events)
    await host.dispatch({ type: "thread.prompt", threadId: first, text: "开工" })
    await host.dispatch(create)
    expect(sessions[0]?.disposed).toBe(false)
    expect(events.some((e) => e.type === "thread.removed" && e.threadId === first)).toBe(false)
  })
})

/**
 * 引擎自报的状态**合并进 `Thread.engineState`，绝不碰 `Thread.trust`**。
 *
 * 「绝不碰 trust」那条不是洁癖：`trust` 同时是 omni 本机审批判定器的输入，
 * 引擎报 yolo 就把它写成 full，等于顺手把 omni 自己那层审批也关掉——
 * 一次用户从没点过的放权，而且没有任何地方会报错。
 */
describe("引擎自报的状态", () => {
  const start = async (): Promise<{ events: Event[]; session: () => Fake; id: string }> => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    return { events, session, id }
  }
  const last = (events: Event[]) => events.filter((e) => e.type === "thread.updated").at(-1)?.thread

  const axis = (a: string, id: string): EngineAxis => ({ axis: a, id, match: "diverged" })

  it("落进 Thread，走 thread.updated——**那样它才跟着事件流落盘，⌘R 之后还在**", async () => {
    const { events, session } = await start()
    session().report({ axes: [axis("mode", "plan")] })
    expect(last(events)?.engineState?.axes).toEqual([axis("mode", "plan")])
  })

  it("**多条轴各自更新各自的**——codex 的 approval 与 sandbox 是两个独立旋钮，不该互相清空", async () => {
    const { events, session } = await start()
    session().report({ axes: [axis("approval", "on-request")] })
    session().report({ axes: [axis("sandbox", "workspace-write")] })
    expect(last(events)?.engineState?.axes.map((a) => a.axis).sort()).toEqual(["approval", "sandbox"])
  })

  it("同一条轴后到的赢", async () => {
    const { events, session } = await start()
    session().report({ axes: [axis("mode", "plan")] })
    session().report({ axes: [axis("mode", "default")] })
    expect(last(events)?.engineState?.axes).toEqual([axis("mode", "default")])
  })

  it("**这次没报的那一样沿用上一次**——引擎往往一次只报一件事", async () => {
    const { events, session } = await start()
    session().report({ modelId: "grok-4.6" })
    session().report({ axes: [axis("mode", "plan")] })
    expect(last(events)?.engineState?.modelId).toBe("grok-4.6")
  })

  it("**绝不碰 trust**——那是审批判定器的输入，写进去就是一次静默提权", async () => {
    const { events, session } = await start()
    session().report({ axes: [{ axis: "mode", id: "yolo", match: "diverged" }] })
    expect(last(events)?.trust).toBe("auto-edit")
  })
})

/**
 * 侧问：问答落进 `Thread.asides`，**不进 transcript**——那是这件事的全部定义。
 * 进了 transcript 它就在正文里，而正文正是模型下一轮要读的东西。
 */
describe("侧问", () => {
  const start = async (): Promise<{ host: Host; events: Event[]; id: string }> => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    return { host, events, id }
  }
  const last = (events: Event[]) => events.filter((e) => e.type === "thread.updated").at(-1)?.thread

  it("问答落进 Thread.asides，按先后排", async () => {
    const { host, events, id } = await start()
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "这个函数干嘛的" })
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "那这个呢" })
    expect(last(events)?.asides?.map((a) => a.question)).toEqual(["这个函数干嘛的", "那这个呢"])
    expect(last(events)?.asides?.[0]?.answer).toBe("答：这个函数干嘛的")
  })

  it("**一条 item 都不产生**——进了 transcript 就不叫侧问了", async () => {
    const { host, events, id } = await start()
    const before = events.filter((e) => e.type === "item.started").length
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "问一句" })
    expect(events.filter((e) => e.type === "item.started").length).toBe(before)
  })

  it("空问题直接不发——省一次真实调用", async () => {
    const { host, events, id } = await start()
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "   " })
    expect(last(events)?.asides).toBeUndefined()
  })

  it("**引擎不支持就抛，不静默吞**——界面本来就不该给这个入口，走到这里说明别处有 bug", async () => {
    const { host, events } = setup({ aside: false })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await expect(host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "问" })).rejects.toThrow(
      /不支持侧问/,
    )
  })
})
