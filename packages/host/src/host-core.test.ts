import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver } from "@switchback/engine"
import { createHost, type Host } from "./host.js"
import { setup, create, items, ask, fakeDriver, type Fake } from "./host-fixture.js"

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

    const settled = items(events)
      .filter((i) => i.kind === "approval")
      .at(-1)
    expect(settled?.kind === "approval" ? settled.status : "").toBe("allowed")
  })

  it("范围原样传到驱动——压成 boolean 就分不出「这一次」和「这轮对话」", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(ask)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: true,
      remember: "once",
    })
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
    const settled = items(events).filter((item) => item.kind === "approval").at(-1)
    // 给引擎的是拒绝；卡片记成「已失效」——这不是用户点的拒绝
    expect(settled?.kind === "approval" ? settled.status : "").toBe("cancelled")
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
    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: true,
      remember: "once",
    })
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
    expect(
      stored.some(
        (e) => e.type === "thread.updated" && e.thread.engineHandle === "codex-thread-abc",
      ),
    ).toBe(true)
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
    // 启动时先清空这家引擎的旧目录，再发 `starting → idle`；末尾才是补句柄。
    expect(events[0]?.type).toBe("thread.started")
    expect(events.map((e) => e.type).slice(1)).toEqual([
      "models.updated",
      "commands.updated",
      "usage.cleared",
      "thread.updated",
      "thread.updated",
    ])
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
    // 它真跑过一轮：有上下文，却没留下句柄
    stored.push({ type: "turn.started", at: 0, turn: { id: "tn-x", threadId: "th-x", engine: "fake", status: "running", startedAt: 0 } })
    await expect(host.dispatch({ type: "thread.resume", threadId: "th-x" })).rejects.toThrow("句柄")
  })

  it("历史里没有这个会话就报错，不静默新建", async () => {
    const { host } = setupWithJournal()
    await expect(host.dispatch({ type: "thread.resume", threadId: "unknown" })).rejects.toThrow(
      "找不到",
    )
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
