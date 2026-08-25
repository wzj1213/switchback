import { describe, expect, it } from "vitest"
import { grokFork, grokSteer } from "./grok-control.js"

describe("Grok 原生控制面", () => {
  it("插话走首方扩展的真实方法名与字段", () => {
    expect(grokSteer("s-1", "转向")).toEqual({
      method: "_x.ai/interject",
      params: { sessionId: "s-1", text: "转向" },
    })
  })

  it("完整分叉同时声明来源和目标工作区，并只认有效的新句柄", () => {
    expect(grokFork.request("s-old", "/w")).toEqual({
      method: "_x.ai/session/fork",
      params: { sourceSessionId: "s-old", sourceCwd: "/w", newCwd: "/w", mcpServers: [] },
    })
    expect(grokFork.handle({ newSessionId: "s-new" })).toBe("s-new")
    expect(grokFork.handle({ sessionId: "s-wrong" })).toBeUndefined()
  })
})
