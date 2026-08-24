import { describe, expect, it } from "vitest"
import { create, setup } from "./host-fixture.js"

/**
 * 压缩上下文这条命令的**时机闸**。
 *
 * 起因是 mac2 上的一次真实故障：轮次没结束时点了「压缩上下文」，Kimi 自己把它拒了，
 * 而拒绝是**以正文形式**回来的——转录区里凭空多出一段
 * 「Compacting conversation context…Compaction is blocked by the current turn;
 * retry when the turn is idle.Compaction cancelled.」，三句连在一起、还是英文，
 * 看起来像模型说了句莫名其妙的话。点两次就出现两段。
 *
 * omni 不去掐引擎已经说出口的正文（那是它自报的状态，改它就是替引擎撒谎），
 * 能做也该做的是**不把这条注定被拒的请求发出去**。
 */
describe("压缩上下文要等这一轮跑完", () => {
  async function opened(): Promise<{ host: ReturnType<typeof setup>["host"]; id: string; session: ReturnType<typeof setup>["session"] }> {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    return { host, id, session }
  }

  it("空闲时照发", async () => {
    const { host, id, session } = await opened()
    await host.dispatch({ type: "thread.compact", threadId: id })
    expect(session().compacted()).toBe(1)
  })

  it("**引擎在跑就明确拒绝**——发过去只会换回一段像是模型说的英文", async () => {
    const { host, id, session } = await opened()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "开工" })
    await expect(host.dispatch({ type: "thread.compact", threadId: id })).rejects.toThrow(/这一轮还在跑/)
    expect(session().compacted()).toBe(0)
  })

  it("那一轮收工之后又能压缩了——拒绝是「现在不行」，不是「这条会话不行」", async () => {
    const { host, id, session } = await opened()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "开工" })
    const turnId = session().prompts[0]?.turnId ?? ""
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await host.dispatch({ type: "thread.compact", threadId: id })
    expect(session().compacted()).toBe(1)
  })
})
