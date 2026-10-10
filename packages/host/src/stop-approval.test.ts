import { describe, expect, it } from "vitest"
import { ask, create, items, setup } from "./host-fixture.js"

describe("审批卡挂着时按停止", () => {
  it("当场收掉、记成「已失效」：引擎在等这张卡的回音，不回它就收不了这一轮", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "推一下" })
    const answer = session().ask(ask)
    await host.dispatch({ type: "thread.interrupt", threadId: id })
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    const card = items(events).filter((item) => item.kind === "approval").at(-1)
    expect(card?.kind === "approval" ? card.status : "").toBe("cancelled")
  })
})

describe("主轮之外来的审批：挂在会话上等人", () => {
  const background = { ...ask, origin: { kind: "subagent" as const, id: "agent-7" } }

  async function idle() {
    const rig = setup()
    await rig.host.dispatch(create)
    const id = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "起一个后台 workflow" })
    rig.session().emit({ type: "turn.completed", at: 1, turnId: rig.session().prompts[0]?.turnId ?? "", status: "completed" })
    return { ...rig, id }
  }
  const pendingOf = (rig: Awaited<ReturnType<typeof idle>>) => rig.host.live().find((thread) => thread.id === rig.id)?.pendingApprovals ?? []

  it("不再替引擎拒：列在会话上，点允许就回允许，那一项随即撤掉；转录区里不发卡", async () => {
    const rig = await idle()
    const answer = rig.session().ask(background)
    const [card] = pendingOf(rig)
    expect(card).toMatchObject({ summary: "git push", origin: { kind: "subagent", id: "agent-7" } })
    // 会话状态不动：`waiting_approval` 在界面上等于「这一轮还在跑」，而此时没有轮次
    expect(rig.host.live().find((thread) => thread.id === rig.id)?.status).toBe("idle")
    await rig.host.dispatch({ type: "approval.resolve", itemId: card?.id ?? "", allow: true, remember: "once", passTurn: true })
    await expect(answer).resolves.toEqual({ allow: true, remember: "once" })
    expect(pendingOf(rig)).toEqual([])
    expect(items(rig.events).filter((item) => item.kind === "approval")).toEqual([])
    // 「本轮剩下的都放行」不适用：这张卡不代表任何一轮
    expect(rig.host.live().find((thread) => thread.id === rig.id)?.passTurn).toBeUndefined()
  })

  it("主轮收工、按停止都只收主轮自己的，它照旧等人", async () => {
    const rig = await idle()
    void rig.session().ask(background)
    await rig.host.dispatch({ type: "thread.prompt", threadId: rig.id, text: "再来一句" })
    await rig.host.dispatch({ type: "thread.interrupt", threadId: rig.id })
    rig.session().emit({ type: "turn.completed", at: 2, turnId: rig.session().prompts[1]?.turnId ?? "", status: "interrupted" })
    expect(pendingOf(rig)).toHaveLength(1)
  })

  it("引擎自己撤回：那一项撤掉，回的是拒绝", async () => {
    const rig = await idle()
    const stop = new AbortController()
    const answer = rig.session().ask(background, { signal: stop.signal })
    stop.abort()
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    expect(pendingOf(rig)).toEqual([])
  })

  it("会话关掉：一起收掉，驱动不会永远等着", async () => {
    const rig = await idle()
    const answer = rig.session().ask(background)
    await rig.host.dispatch({ type: "thread.delete", threadId: rig.id })
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
  })
})

describe("「本轮剩下的都放行」不吞子 agent 来要的", () => {
  it("主轮里子 agent 要权限：照样出卡", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "推一下" })
    void session().ask(ask)
    const first = items(events).filter((item) => item.kind === "approval").at(-1)
    await host.dispatch({ type: "approval.resolve", itemId: first?.id ?? "", allow: true, remember: "once", passTurn: true })
    void session().ask({ ...ask, toolCallId: "toolu_2", origin: { kind: "subagent", id: "agent-7" } })
    // 每张卡取最后一次的样子：第一张已经批过了
    const latest = new Map(items(events).filter((item) => item.kind === "approval").map((item) => [item.id, item]))
    const cards = [...latest.values()].filter((item) => item.kind === "approval" && item.status === "pending")
    expect(cards).toEqual([expect.objectContaining({ origin: { kind: "subagent", id: "agent-7" } })])
  })
})
