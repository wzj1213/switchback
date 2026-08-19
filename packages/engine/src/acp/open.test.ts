import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { openSession, type OpenCtx, type OpenState } from "./open.js"

/**
 * **形状取自实测**（`grok agent stdio`，grok-build）：
 *
 * ```
 * session/new  → { sessionId, models, _meta }
 * session/load → {            models, _meta }     ← 只少 sessionId 这一个字段
 * ```
 *
 * 少的那一个字段正是这组测试的全部理由：目录在续跑回包里是**齐的**，
 * 而 `adopt()` 会因为缺 sessionId 直接抛——所以续跑不能复用它，
 * 也不能像上一版那样把整个回包丢掉。
 */
const MODELS = {
  currentModelId: "grok-4.6",
  availableModels: [
    { modelId: "grok-4.6", name: "Grok 4.6", _meta: { totalContextTokens: 500_000 } },
    { modelId: "grok-4.6-fast", name: "Grok 4.6 Fast", _meta: { totalContextTokens: 200_000 } },
  ],
}

function stateWith(): OpenState {
  return {
    acpSession: undefined,
    modes: [],
    mode: undefined,
    models: [],
    loadSession: true,
    canList: undefined,
    effort: undefined,
    modelConfig: undefined,
    effortConfig: undefined,
    windowOf: {},
    contextWindow: undefined,
    caps: NO_CAPABILITIES,
    trust: "auto-edit",
    native: undefined,
    stderr: "",
  }
}

function ctxWith(reply: unknown, req: Partial<StartRequest> = {}) {
  const calls: { method: string; params: unknown }[] = []
  const state = stateWith()
  const handles: string[] = []
  const ctx = {
    rpc: {
      call: (method: string, params: unknown) => {
        calls.push({ method, params })
        return Promise.resolve(reply)
      },
    },
    owner: {},
    config: { id: "acp:grok", command: "grok" },
    req: {
      threadId: "t-1",
      cwd: "/w",
      trust: "auto-edit",
      home: "/home/dev",
      onHandle: (h: string) => handles.push(h),
      ...req,
    },
    state,
  } as unknown as OpenCtx
  return { ctx, calls, state, handles }
}

describe("续跑时 session/load 的回包要接住", () => {
  it("**回包里的目录要落到 state 上**——上一版整个丢掉，于是续跑的会话上目录全空", async () => {
    const h = ctxWith({ models: MODELS }, { resume: "s-old" })
    await openSession(h.ctx)
    expect(h.calls.map((c) => c.method)).toEqual(["session/load"])
    expect(h.state.models.map((m) => m.id)).toEqual(["grok-4.6", "grok-4.6-fast"])
    // 分母有了，上下文比例条才画得出来
    expect(h.state.contextWindow).toBe(500_000)
    expect(h.state.windowOf["grok-4.6-fast"]).toBe(200_000)
  })

  it("**回包没有 sessionId 也不许抛**——实测 session/load 就是不回它，id 由调用方给", async () => {
    const h = ctxWith({ models: MODELS }, { resume: "s-old" })
    await expect(openSession(h.ctx)).resolves.toBeUndefined()
    expect(h.state.acpSession).toBe("s-old")
    expect(h.handles).toEqual(["s-old"])
  })

  it("回包整个缺席时安静降级，不掀翻续跑——认不出的形状不该比丢字段更严重", async () => {
    const h = ctxWith(null, { resume: "s-old" })
    await expect(openSession(h.ctx)).resolves.toBeUndefined()
    expect(h.state.acpSession).toBe("s-old")
    expect(h.state.models).toEqual([])
  })

  it("引擎不支持续跑时照旧摆出来，不静默新开", async () => {
    const h = ctxWith({ models: MODELS }, { resume: "s-old" })
    h.state.loadSession = false
    await expect(openSession(h.ctx)).rejects.toThrow(/不支持续跑/)
    expect(h.calls).toEqual([])
  })
})

describe("新建会话仍然认 sessionId", () => {
  it("**新建没给 sessionId 就必须抛**——那条路的 id 只可能来自回包，接着跑下去只会更晚炸", async () => {
    const h = ctxWith({ models: MODELS })
    await expect(openSession(h.ctx)).rejects.toThrow(/没有返回 sessionId/)
  })

  it("给了就认领，目录走同一条路", async () => {
    const h = ctxWith({ sessionId: "s-new", models: MODELS })
    await openSession(h.ctx)
    expect(h.state.acpSession).toBe("s-new")
    expect(h.state.models).toHaveLength(2)
    expect(h.state.contextWindow).toBe(500_000)
  })
})
