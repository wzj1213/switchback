import { describe, expect, it } from "vitest"
import type { EngineStatus } from "@omni/protocol"
import { applyModel } from "./model.js"

/** 一个只记账的 ACP 会话：换模型放行，设强度按开关决定成不成。 */
function ctxWith(options: { effortFails?: boolean; effort?: string } = {}) {
  const calls: { method: string; params: unknown }[] = []
  const said: { status: EngineStatus; detail?: string }[] = []
  const state = {
    acpSession: "s-1",
    modelConfig: "model",
    effortConfig: "thought",
    effort: options.effort,
    windowOf: {} as Record<string, number>,
    contextWindow: undefined as number | undefined,
  }
  const ctx = {
    id: "acp:zcode",
    state,
    call: (method: string, params: unknown) => {
      calls.push({ method, params })
      const bad = options.effortFails === true && (params as { configId?: string }).configId === "thought"
      // ZCode 的桥实测就是这句：它把 thought 报成可选，设进去必然 Internal error
      return bad
        ? Promise.reject(new Error("Internal error：unsupported config option or switch failed: thought"))
        : Promise.resolve({})
    },
    status: (status: EngineStatus, detail?: string) => {
      said.push({ status, ...(detail === undefined ? {} : { detail }) })
    },
  }
  return { ctx, calls, said, state }
}

describe("换模型顺带换强度", () => {
  it("两步都成时，回报的是新那一档", async () => {
    const h = ctxWith({ effort: "max" })
    const applied = await applyModel(h.ctx, "GLM-5-Turbo", "low")
    expect(applied).toEqual({ effort: "low" })
    expect(h.calls.map((c) => (c.params as { configId: string }).configId)).toEqual(["model", "thought"])
  })

  it("**强度设不上时，回报的是引擎那边还在用的那一档**——不是请求的那个", async () => {
    // 这条守的是一个真出过的毛病：输入区显示「轻度」，而引擎其实在 max。
    // 界面照着会话记录画，所以记录里不能是「我请求了什么」
    const h = ctxWith({ effortFails: true, effort: "max" })
    const applied = await applyModel(h.ctx, "GLM-5-Turbo", "low")
    expect(applied).toEqual({ effort: "max" })
  })

  it("强度设不上不算换模型失败——模型确实换了，只发一条 degraded", async () => {
    const h = ctxWith({ effortFails: true, effort: "max" })
    await expect(applyModel(h.ctx, "GLM-5-Turbo", "low")).resolves.toBeDefined()
    expect(h.said).toHaveLength(1)
    expect(h.said[0]?.status).toBe("degraded")
    expect(h.said[0]?.detail).toContain("推理强度")
  })

  it("**换模型本身失败要抛**——那是真的没换成，不能当没事发生", async () => {
    const h = ctxWith()
    h.ctx.call = () => Promise.reject(new Error("Method not found"))
    await expect(applyModel(h.ctx, "GLM-5-Turbo", "low")).rejects.toThrow(/换模型/u)
  })

  it("这家不报强度时不多发那一发", async () => {
    const h = ctxWith()
    h.state.effortConfig = undefined as unknown as string
    const applied = await applyModel(h.ctx, "GLM-5-Turbo", "low")
    expect(h.calls).toHaveLength(1)
    expect(applied).toEqual({})
  })

  it("会话还没开就什么都不做", async () => {
    const h = ctxWith()
    h.state.acpSession = undefined as unknown as string
    expect(await applyModel(h.ctx, "GLM-5-Turbo", "low")).toEqual({})
    expect(h.calls).toEqual([])
  })
})
