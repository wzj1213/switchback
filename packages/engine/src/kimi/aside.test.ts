import { describe, expect, it } from "vitest"
import { KimiAsides } from "./aside.js"
import type { KimiApi } from "./http.js"

describe("Kimi 侧问", () => {
  it("只收 BTW agent 的文字，不让它混进主线", async () => {
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) =>
        Promise.resolve((path.endsWith(":btw") ? { agent_id: "btw-1" } : { prompt_id: "p1", status: "running" }) as T),
    }
    const asides = new KimiAsides(api, "s1")
    const answer = asides.ask("2+2？")
    await Promise.resolve()
    expect(asides.handle({ type: "assistant.delta", agentId: "main", delta: "主线" })).toBe(false)
    expect(asides.handle({ type: "assistant.delta", agentId: "btw-1", delta: "四" })).toBe(true)
    expect(asides.handle({ type: "turn.ended", agentId: "btw-1", reason: "completed" })).toBe(true)
    await expect(answer).resolves.toBe("四")
    asides.dispose()
  })

  it("原生侧问没有启动就明确失败", async () => {
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) =>
        Promise.resolve((path.endsWith(":btw") ? { agent_id: "btw-1" } : { prompt_id: "p1", status: "aborted" }) as T),
    }
    const asides = new KimiAsides(api, "s1")

    await expect(asides.ask("问题")).rejects.toThrow("没有开始侧问")
    asides.dispose()
  })
})
