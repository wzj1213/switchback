import { describe, expect, it } from "vitest"
import type { Event, Item } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk, EngineDriver, EngineSession } from "@omni/engine"
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
  report: (handle: string) => void
  /** 当前生效的记忆规则。取值函数——中途加的规则要立刻能读到。 */
  memory: () => readonly Rule[]
}

function fakeDriver(): { driver: EngineDriver; session: () => Fake } {
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
        report: (handle) => req.onHandle?.(handle),
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
        setTrust: () => Promise.resolve(),
        models: () => Promise.resolve([]),
        setModel: () => Promise.resolve(),
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

function setup(): { host: Host; events: Event[]; session: () => Fake } {
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
    expect(statuses()).toEqual(["running"])

    const answer = session().ask(ask)
    expect(statuses()).toEqual(["running", "waiting_approval"])

    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "once" })
    await answer
    expect(statuses()).toEqual(["running", "waiting_approval", "running"])

    const turnId = session().prompts[0]?.turnId ?? ""
    session().emit({ type: "turn.completed", at: 0, turnId, status: "completed" })
    expect(statuses()).toEqual(["running", "waiting_approval", "running", "idle"])
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
      },
    })
    return { host, events, session, stored }
  }

  it("驱动上报的句柄走 thread.updated 落盘——续跑要的东西必须和历史存在同一个地方", async () => {
    const { host, events, session, stored } = setupWithJournal()
    await host.dispatch(create)
    session().report("codex-thread-abc")
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.engineHandle : "").toBe("codex-thread-abc")
    expect(stored.some((e) => e.type === "thread.updated" && e.thread.engineHandle === "codex-thread-abc")).toBe(true)
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
          setTrust: () => Promise.resolve(),
          models: () => Promise.resolve([]),
          setModel: () => Promise.resolve(),
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
    session().report("h")
    session().report("h")
    expect(events.filter((e) => e.type === "thread.updated")).toHaveLength(base + 1)
  })

  it("续跑把句柄交给驱动，并把 detached 摘掉", async () => {
    const { host, events, session } = setupWithJournal()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    session().report("h-1")
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
          report: (h) => req.onHandle?.(h),
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
          setTrust: () => Promise.resolve(),
          models: () => Promise.resolve([]),
          setModel: () => Promise.resolve(),
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
      },
    })
  return { host, events, sessions, stored }
}

describe("跨引擎接力", () => {
  const setupTwo = setupTwoEngines

  const handoffTo = async (
    host: Host,
    events: Event[],
    to: string,
  ): Promise<string> => {
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    await host.dispatch({ type: "thread.handoff", threadId, to })
    return threadId
  }

  it("先停旧的再起新的——两个引擎同时对着一个工作区写是最难查的冲突", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    await handoffTo(host, events, "other")
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    expect(sessions[1]?.disposed).toBe(false)
  })

  it("交接包作为第一条消息发给接手的那一家，并且带着目标", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    await handoffTo(host, events, "other")
    const first = sessions[1]?.prompts[0]?.text ?? ""
    expect(first).toContain("接手")
    expect(first).toContain("把 X 改成 Y")
  })

  it("会话 id 不变，引擎历史往后接一手", async () => {
    const { host, events } = setupTwo()
    await host.dispatch(create)
    const threadId = await handoffTo(host, events, "other")
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.id).toBe(threadId)
    expect(thread?.engineHistory).toEqual(["fake", "other"])
  })

  it("**旧引擎的会话句柄要清掉**——留着的话续跑会拿它去问新的一家", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    sessions[0]?.report("old-handle")
    await handoffTo(host, events, "other")
    const updates = events.filter((e) => e.type === "thread.updated")
    const afterHandoff = updates.at(-1)
    const thread = afterHandoff?.type === "thread.updated" ? afterHandoff.thread : undefined
    expect(thread?.engineHandle).not.toBe("old-handle")
  })

  it("接力到自己是无操作——不该白白重启一次引擎", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    await handoffTo(host, events, "fake")
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

  it("只交目标，**不带「已改动的文件」**——那会让第二家以为活干了一半", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    const first = sessions[1]?.prompts[0]?.text ?? ""
    expect(first).toContain("把 X 改成 Y")
    expect(first).not.toContain("已改动的文件")
    expect(first).not.toContain("接手")
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
        setTrust: () => Promise.resolve(),
        models: () => Promise.resolve([]),
        setModel: () => Promise.resolve(),
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

  it("**上一轮还在跑就拒**——不拒的话 entry.turn 被覆盖，引擎还在往旧 turnId 上发 item，正在流的回答会整个消失", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const first = events.find((e) => e.type === "thread.started")
    const threadId = first?.type === "thread.started" ? first.thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "一" })
    await expect(host.dispatch({ type: "thread.prompt", threadId, text: "二" })).rejects.toThrow("上一轮还没跑完")
    expect(session().prompts).toHaveLength(1)
  })
})
