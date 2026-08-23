import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { mine, onForeign, type ForeignCtx } from "./route.js"

describe("这条通知归不归我", () => {
  it("**是我的会话才收**", () => {
    expect(mine("s-1", "s-1")).toBe(true)
    expect(mine("s-2", "s-1")).toBe(false)
  })

  /**
   * 协议上 `sessionId` 是可选的。一律拦掉的话，不带这个字段的那几家**一条更新都收不到**
   * ——那比串台严重得多。**猜错的方向必须是安全的那一边**，而这里「安全」是收下。
   */
  it("报不上来就放行——不带这个字段的引擎不该一条更新都收不到", () => {
    expect(mine(undefined, "s-1")).toBe(true)
    expect(mine("s-1", undefined)).toBe(true)
  })
})

describe("协议之外的私有通知", () => {
  function ctxWith(config: ForeignCtx["config"]) {
    const events: Event[] = []
    const models: { model?: string; effort?: string }[] = []
    const states: unknown[] = []
    const state = {
      effort: undefined as string | undefined,
      windowOf: { "grok-4.6": 2000 } as Record<string, number>,
      contextWindow: 1000 as number | undefined,
    }
    const ctx = {
      config,
      state,
      req: {
        onModel: (model?: string, effort?: string) => models.push({ model, effort }),
        onEngineState: (patch: unknown) => states.push(patch),
        threadId: "t1",
        emit: (e: Event) => events.push(e),
      },
      update: () => ({ threadId: "t1", engine: "acp:x", emit: (e: Event) => events.push(e), now: () => 0 }),
    } as unknown as ForeignCtx
    return { ctx, events, models, states, state }
  }

  it("换模型的回声：落到状态上，并沿 onModel / onEngineState 两条路报上去", () => {
    const h = ctxWith({ modelChanged: () => ({ model: "grok-4.6", effort: "xhigh" }) })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.state.effort).toBe("xhigh")
    expect(h.state.contextWindow).toBe(2000)
    expect(h.models).toEqual([{ model: "grok-4.6", effort: "xhigh" }])
    expect(h.states).toEqual([{ modelId: "grok-4.6" }])
  })

  it("引擎自己换到没报告窗口的模型时也清掉旧分母", () => {
    const h = ctxWith({ modelChanged: () => ({ model: "unknown" }) })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.state.contextWindow).toBeUndefined()
  })

  it("只报了强度就不报模型状态——**没认出来的不编一个**", () => {
    const h = ctxWith({ modelChanged: () => ({ effort: "low" }) })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.states).toEqual([])
    expect(h.state.effort).toBe("low")
  })

  it("各家都不认这条时什么都不做", () => {
    const h = ctxWith({})
    onForeign(h.ctx, "_x.ai/whatever", {})
    expect(h.events).toEqual([])
    expect(h.models).toEqual([])
  })

  it("用量那条照旧走，且和换模型互不影响", () => {
    const h = ctxWith({ contextUsed: () => 42, modelChanged: () => undefined })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.events.filter((e) => e.type === "usage.updated")).toHaveLength(1)
  })

  it("缓存命中进了 usage 事件；没报就不带这个字段", () => {
    const withHit = ctxWith({ contextUsed: () => 42, cacheRead: () => 17 })
    onForeign(withHit.ctx, "_x.ai/session_notification", {})
    const hit = withHit.events.find((e) => e.type === "usage.updated")
    expect(hit?.type === "usage.updated" ? hit.usage.cacheRead : undefined).toBe(17)

    const without = ctxWith({ contextUsed: () => 42, cacheRead: () => undefined })
    onForeign(without.ctx, "_x.ai/session_notification", {})
    const miss = without.events.find((e) => e.type === "usage.updated")
    expect(miss?.type === "usage.updated" ? "cacheRead" in miss.usage : true).toBe(false)
  })
})
