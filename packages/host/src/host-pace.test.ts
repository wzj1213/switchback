import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { create, setup } from "./host-fixture.js"

/** 开一条会话、发一句话：宿主开了轮（夹具的时钟恒为 0），驱动拿到了 turnId。 */
async function running(): Promise<{ events: Event[]; emit: (event: Event) => void; turnId: string }> {
  const { host, events, session } = setup()
  await host.dispatch(create)
  const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
  await host.dispatch({ type: "thread.prompt", threadId, text: "分页那段也改一下" })
  return { events, emit: session().emit, turnId: session().prompts[0]?.turnId ?? "" }
}

const paceOf = (events: readonly Event[]): unknown => {
  const done = events.find((event) => event.type === "turn.completed")
  return done?.type === "turn.completed" ? done.pace : "没有收工"
}

describe("宿主量每一轮的出字节奏", () => {
  it("收工那一条带着节奏发出去：界面拿到的和落盘的是同一条", async () => {
    const { events, emit, turnId } = await running()
    emit({ type: "item.started", at: 500, item: { id: "a", turnId, at: 500, kind: "agent_message", text: "", complete: false } })
    for (const at of [600, 800, 1000, 1200, 1400, 1600]) emit({ type: "item.delta", at, itemId: "a", append: "分页照搬" })
    emit({ type: "turn.completed", at: 2000, turnId, status: "completed" })
    // 首字 600ms；后五批 15 个 token / 1 秒；引擎没报生成量，是估的
    expect(paceOf(events)).toEqual({ firstMs: 600, tps: 15, tokens: 18, exact: false })
  })

  it("引擎报了生成量就用真数", async () => {
    const { events, emit, turnId } = await running()
    emit({ type: "item.started", at: 500, item: { id: "a", turnId, at: 500, kind: "agent_message", text: "", complete: false } })
    for (const at of [600, 1100, 1600]) emit({ type: "item.delta", at, itemId: "a", append: "分页照搬" })
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    emit({ type: "usage.updated", at: 1700, threadId, engine: "fake", usage: { contextUsed: 900, outputTokens: 50 } })
    emit({ type: "turn.completed", at: 1800, turnId, status: "completed" })
    expect(paceOf(events)).toEqual({ firstMs: 600, tps: 50, tokens: 50, exact: true })
  })

  it("一个字都没写就收工（开跑就被停下）：不带节奏，分界线上也就不印", async () => {
    const { events, emit, turnId } = await running()
    emit({ type: "turn.completed", at: 300, turnId, status: "interrupted" })
    expect(paceOf(events)).toBeUndefined()
  })
})
