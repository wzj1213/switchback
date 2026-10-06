import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { foreignSessionId, mine, onForeign, type ForeignCtx } from "./route.js"

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

  it("私有通知认顶层和 leader 包装里的 sessionId", () => {
    expect(foreignSessionId({ sessionId: "direct" })).toBe("direct")
    expect(foreignSessionId({ params: { sessionId: "nested" } })).toBe("nested")
    expect(foreignSessionId({ sessionId: 1 })).toBeUndefined()
  })
})

describe("协议之外的私有通知", () => {
  function ctxWith(
    config: ForeignCtx["config"],
    activity: ForeignCtx["activity"] = undefined,
    hasTurn = true,
  ) {
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
      activity,
      state,
      req: {
        onModel: (model?: string, effort?: string) => models.push({ model, effort }),
        onEngineState: (patch: unknown) => states.push(patch),
        threadId: "t1",
        emit: (e: Event) => events.push(e),
      },
      update: () => ({
        threadId: "t1",
        engine: "acp:x",
        emit: (e: Event) => events.push(e),
        turnId: () => hasTurn ? "turn-1" : undefined,
        newId: (prefix: string) => `${prefix}-1`,
        now: () => 0,
      }),
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

  it("引擎明确发给人的私有提示进入当前轮次，不冒充模型正文", () => {
    const h = ctxWith({ notice: () => ({ message: "Image 1 was dropped: corrupt.", level: "warning" }) })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.events).toMatchObject([
      {
        type: "item.started",
        item: { id: "notice-1", turnId: "turn-1", kind: "notice", level: "warning" },
      },
    ])
  })

  it("会话级原生通知在开场尚无轮次时也不会静默丢失", () => {
    const h = ctxWith({
      notification: () => ({
        key: "model-unavailable", message: "旧模型不可用，已自动切换。", priority: "high",
      }),
    }, undefined, false)
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.events).toEqual([{
      type: "engine.notification", at: 0, threadId: "t1", engine: "acp:x",
      key: "model-unavailable", message: "旧模型不可用，已自动切换。", priority: "high",
    }])
  })

  it("私有工具结果进入当前轮次，保留原生状态与明细", () => {
    const h = ctxWith({ toolItems: () => [{
      tool: "hook/pre_tool_use", status: "denied", error: "guard blocked it",
      promptId: "turn-1",
      detail: { kind: "other", name: "guard", input: { elapsedMs: 12 } },
    }] })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.events).toMatchObject([{
      type: "item.started",
      item: { id: "foreign-tool-1", turnId: "turn-1", tool: "hook/pre_tool_use", status: "denied" },
    }])
  })

  it("带 promptId 的迟到工具结果不串进下一轮", () => {
    const h = ctxWith({ toolItems: () => [{
      tool: "hook/stop", status: "failed", error: "previous turn failed",
      promptId: "turn-old", detail: { kind: "other", name: "late" },
    }] })
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.events).toEqual([{
      type: "engine.notification", at: 0, threadId: "t1", engine: "acp:x",
      key: "foreign-tool-1", message: "previous turn failed", priority: "high",
    }])
  })

  it("轮次外失败的私有工具结果仍发会话通知，普通成功保持安静", () => {
    const tools = [{
      tool: "hook/session_start", status: "failed" as const, error: "startup hook failed",
      detail: { kind: "other" as const, name: "bootstrap" },
    }, {
      tool: "hook/session_start", status: "ok" as const,
      detail: { kind: "other" as const, name: "quiet" },
    }]
    const h = ctxWith({ toolItems: () => tools }, undefined, false)
    onForeign(h.ctx, "_x.ai/session_notification", {})
    expect(h.events).toEqual([{
      type: "engine.notification", at: 0, threadId: "t1", engine: "acp:x",
      key: "foreign-tool-1", message: "startup hook failed", priority: "high",
    }])
  })

  it("原生后台活动按稳定 id 发完整 lane 快照", () => {
    const h = ctxWith({}, () => ({
      id: "grok-task-bg-1", title: "等待服务启动", status: "running", handle: "bg-1",
    }))
    onForeign(h.ctx, "_x.ai/task_backgrounded", {})
    expect(h.events).toMatchObject([
      {
        type: "lane.updated",
        threadId: "t1",
        lane: { id: "grok-task-bg-1", kind: "activity", status: "running", handle: "bg-1" },
      },
    ])
  })

  it("原生活动输出回到对应工具，并带会话身份供 journal 定位", () => {
    const h = ctxWith({}, () => ({ itemId: "monitor-call", append: "tick\n" }))
    onForeign(h.ctx, "_x.ai/monitor_event", {})
    expect(h.events).toEqual([{
      type: "item.delta", at: 0, threadId: "t1", itemId: "monitor-call", append: "tick\n",
    }])
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
