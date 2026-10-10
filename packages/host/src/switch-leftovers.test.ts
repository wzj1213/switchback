import { describe, expect, it } from "vitest"
import { create, setupTwoEngines } from "./host-fixture.js"

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function failedWithLeftover(rig: ReturnType<typeof setupTwoEngines>): Promise<string> {
  await rig.host.dispatch(create)
  const id = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
  await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
  rig.sessions[0]?.handle("h-a")
  await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "排着的第二句" })
  rig.sessions[0]?.emit({ type: "turn.completed", at: 0, turnId: rig.sessions[0].prompts[0]?.turnId ?? "", status: "failed", error: "401" })
  await tick()
  return id
}

describe("换引擎时的遗留", () => {
  it("失败留下的「待发送」不在「现在就切」那一刻发给新那家", async () => {
    const rig = setupTwoEngines({ handoffBrief: () => Promise.resolve("<note/>") })
    const id = await failedWithLeftover(rig)
    expect(rig.host.live()[0]?.queued).toEqual(["排着的第二句"])
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "other" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    await tick()
    expect(rig.sessions[1]?.prompts ?? []).toEqual([])
    expect(rig.host.live()[0]).toMatchObject({ engine: "other", queued: ["排着的第二句"] })
  })

  it("上一家挂着的问题不跟到新那家：那边已经按跳过落定，留着就是答不掉的死卡", async () => {
    const rig = setupTwoEngines()
    await rig.host.dispatch(create)
    const id = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    rig.sessions[0]?.handle("h-a")
    rig.sessions[0]?.emit({ type: "turn.completed", at: 0, turnId: rig.sessions[0].prompts[0]?.turnId ?? "", status: "completed" })
    const answer = rig.sessions[0]?.question([{ id: "q1", question: "选哪个？", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }])
    expect(rig.host.live()[0]?.pendingQuestions).toHaveLength(1)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "other" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    await expect(answer).resolves.toEqual({ dismissed: true })
    expect(rig.host.live()[0]).toMatchObject({ engine: "other" })
    expect(rig.host.live()[0]?.pendingQuestions).toBeUndefined()
  })
})
