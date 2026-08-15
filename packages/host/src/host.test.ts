import { describe, expect, it } from "vitest"
import type { Event, Item } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk, EngineDriver, EngineSession } from "@omni/engine"
import { createHost, type Host } from "./host.js"

interface Fake {
  prompts: { text: string; turnId: string }[]
  disposed: boolean
  ask: (a: ApprovalAsk) => Promise<ApprovalAnswer>
  /** 驱动侧的出口。测试用它冒充引擎发事件，走宿主包装过的那条路。 */
  emit: (e: Event) => void
}

function fakeDriver(): { driver: EngineDriver; session: () => Fake } {
  const holder: { fake: Fake | undefined } = { fake: undefined }
  const driver: EngineDriver = {
    id: "fake",
    start: (req) => {
      const fake: Fake = { prompts: [], disposed: false, ask: req.askUser, emit: req.emit }
      holder.fake = fake
      const session: EngineSession = {
        threadId: req.threadId,
        prompt: (text, turnId) => {
          fake.prompts.push({ text, turnId })
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve(),
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
    const statuses = (): string[] =>
      events.filter((e) => e.type === "thread.updated").map((e) => e.thread.status)

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

  it("尚未实现的接力明确报错，而不是静默无反应", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await expect(host.dispatch({ type: "thread.handoff", threadId, to: "codex" })).rejects.toThrow(
      "尚未实现",
    )
  })
})
