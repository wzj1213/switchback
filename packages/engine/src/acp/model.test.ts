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
    models: [] as { id: string; label: string; efforts?: readonly string[] }[],
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

  it("换到没有强度的模型时清掉上一模型的旧档，不拿旧值冒充新模型状态", async () => {
    const h = ctxWith({ effort: "max" })
    h.state.effortConfig = undefined as unknown as string
    h.state.models = [{ id: "plain", label: "Plain" }]
    expect(await applyModel(h.ctx, "plain")).toEqual({})
    expect(h.state.effort).toBeUndefined()
  })

  it("目标模型没报告窗口时清掉旧分母；报告了才换成新值", async () => {
    const h = ctxWith()
    h.state.contextWindow = 500_000
    await applyModel(h.ctx, "unknown")
    expect(h.state.contextWindow).toBeUndefined()
    h.state.windowOf.known = 200_000
    await applyModel(h.ctx, "known")
    expect(h.state.contextWindow).toBe(200_000)
  })

  it("会话还没开就什么都不做", async () => {
    const h = ctxWith()
    h.state.acpSession = undefined as unknown as string
    expect(await applyModel(h.ctx, "GLM-5-Turbo", "low")).toEqual({})
    expect(h.calls).toEqual([])
  })
})

/**
 * 第三条路：**强度在模型清单的扩展位里**（实测 grok 的 `_meta.reasoningEfforts`）。
 * 判据是「清单从哪儿读来的，就设回哪儿」——和换模型那条路同一条原则。
 */
describe("强度折进 set_model 的 _meta（grok 那条路）", () => {
  function metaCtx() {
    const calls: { method: string; params: unknown }[] = []
    const state = {
      acpSession: "s-1",
      modelConfig: undefined as string | undefined,
      // **没有 effortConfig**：这家不把强度做成独立选项
      effortConfig: undefined as string | undefined,
      models: [{ id: "grok-4.6", label: "Grok 4.6", efforts: ["xhigh", "high", "low"] }],
      effort: undefined as string | undefined,
      windowOf: {} as Record<string, number>,
      contextWindow: undefined as number | undefined,
    }
    const ctx = {
      id: "acp:grok",
      state,
      call: (method: string, params: unknown) => {
        calls.push({ method, params })
        return Promise.resolve({})
      },
      status: () => undefined,
    }
    return { ctx, calls, state }
  }

  it("**同一发发出去**，不是两发——分两发的话中间那一刻模型换了、强度还是旧的", async () => {
    const h = metaCtx()
    await applyModel(h.ctx, "grok-4.6", "xhigh")
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.method).toBe("session/set_model")
    expect(h.calls[0]?.params).toEqual({
      sessionId: "s-1",
      modelId: "grok-4.6",
      _meta: { reasoningEffort: "xhigh" },
    })
  })

  it("回报生效的那一档", async () => {
    const h = metaCtx()
    expect(await applyModel(h.ctx, "grok-4.6", "low")).toEqual({ effort: "low" })
  })

  it("没给强度就不带 `_meta`——不塞一个引擎没要的字段", async () => {
    const h = metaCtx()
    await applyModel(h.ctx, "grok-4.6")
    expect(h.calls[0]?.params).toEqual({ sessionId: "s-1", modelId: "grok-4.6" })
  })

  it("**目标模型不带 efforts 就不走这条路**——那说明这家的强度不在这儿", async () => {
    const h = metaCtx()
    h.state.models = [{ id: "grok-4.6", label: "Grok 4.6", efforts: [] }]
    await applyModel(h.ctx, "grok-4.6", "high")
    expect(h.calls[0]?.params).toEqual({ sessionId: "s-1", modelId: "grok-4.6" })
  })
})
