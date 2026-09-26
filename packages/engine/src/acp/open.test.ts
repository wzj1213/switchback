import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { RpcError } from "../rpc.js"
import { AcpAuthRequired } from "./auth.js"
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

describe("ACP 分叉只承诺复制末尾", () => {
  it("完整分叉照常交给 session/fork", async () => {
    const h = ctxWith({ sessionId: "s-fork" }, { forkOf: { handle: "s-old" } })
    await openSession(h.ctx)
    expect(h.calls.map((call) => call.method)).toEqual(["session/fork"])
    expect(h.state.acpSession).toBe("s-fork")
  })

  it("历史回退在出线前拒绝，不把完整历史冒充成截断结果", async () => {
    const h = ctxWith({ sessionId: "s-fork" }, { forkOf: { handle: "s-old", dropTurns: 2 } })
    await expect(openSession(h.ctx)).rejects.toThrow(/不能停在历史轮次/)
    expect(h.calls).toEqual([])
  })

  it("厂商分叉扩展回句柄后再用标准 load 接入新会话", async () => {
    const h = ctxWith({ newSessionId: "s-native", models: MODELS }, { forkOf: { handle: "s-old" } })
    h.ctx.config.fork = {
      request: (sourceSessionId, cwd) => ({ method: "vendor/fork", params: { sourceSessionId, cwd } }),
      handle: (raw) => (raw as { newSessionId?: string }).newSessionId,
    }
    await openSession(h.ctx)
    expect(h.calls).toEqual([
      { method: "vendor/fork", params: { sourceSessionId: "s-old", cwd: "/w" } },
      { method: "session/load", params: { sessionId: "s-native", cwd: "/w", mcpServers: [] } },
    ])
    expect(h.state.acpSession).toBe("s-native")
    expect(h.state.models).toHaveLength(2)
  })
})

describe("开会话撞上 -32000（要先登录）", () => {
  const refuse = (h: ReturnType<typeof ctxWith>, error: { code: number; message: string; data?: unknown }): void => {
    h.ctx.rpc.call = () => Promise.reject(new RpcError(error))
  }

  it("认错误码不认措辞：它的原话、握手时报的登录方式、去哪儿登录，一句说清", async () => {
    const h = ctxWith({})
    h.ctx.config.label = "Gemini CLI"
    h.state.authMethods = [{ id: "oauth-personal", name: "Log in with Google", kind: "agent" }]
    // 实测 Gemini CLI 在这一码下说的根本不是「请登录」
    refuse(h, { code: -32000, message: "This client is no longer supported", data: { authMethods: [] } })
    const error = (await openSession(h.ctx).catch((caught: unknown) => caught)) as Error
    expect(error).toBeInstanceOf(AcpAuthRequired)
    expect(error.message).toContain("Gemini CLI 要先登录")
    expect(error.message).toContain("This client is no longer supported")
    // data 里那串 JSON 不拖进人话里
    expect(error.message).not.toContain("authMethods")
    expect(error.message).toContain("Log in with Google")
  })

  it("续跑撞上同一码也一样翻译；别的码原样抛", async () => {
    const h = ctxWith({}, { resume: "s-old" })
    refuse(h, { code: -32000, message: "Authentication required" })
    await expect(openSession(h.ctx)).rejects.toThrow(/acp:grok 要先登录/)
    const other = ctxWith({})
    refuse(other, { code: -32603, message: "炸了" })
    await expect(openSession(other.ctx)).rejects.toThrow("炸了")
  })
})
