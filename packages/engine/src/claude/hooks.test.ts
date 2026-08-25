import { afterEach, describe, expect, it, vi } from "vitest"
import type { Event, TurnId } from "@omni/protocol"
import { closeHooks, createHookState, onHookMessage } from "./hooks.js"

function setup(turn: TurnId | null = "turn-1") {
  const events: Event[] = []
  const state = createHookState()
  const ctx = {
    threadId: "thread-1", turnId: () => turn ?? undefined,
    emit: (event: Event) => events.push(event), now: () => 100,
  }
  return { events, state, ctx }
}

const hook = (subtype: string, patch: Record<string, unknown> = {}) => ({
  type: "system", subtype, hook_id: "hook-1", hook_name: "PreToolUse:guard",
  hook_event: "PreToolUse", ...patch,
})

afterEach(() => vi.useRealTimers())

describe("Claude Hook 生命周期", () => {
  it("300ms 内无输出成功保持安静", () => {
    vi.useFakeTimers()
    const { events, state, ctx } = setup()
    onHookMessage(state, hook("hook_started"), ctx)
    onHookMessage(state, hook("hook_response", { outcome: "success", output: "" }), ctx)
    vi.runAllTimers()
    expect(events).toEqual([])
  })

  it("慢 Hook 显示运行态并以原生输出收口", () => {
    vi.useFakeTimers()
    const { events, state, ctx } = setup()
    onHookMessage(state, hook("hook_started"), ctx)
    vi.advanceTimersByTime(300)
    onHookMessage(state, hook("hook_progress", { output: "checking" }), ctx)
    onHookMessage(state, hook("hook_response", { outcome: "success", output: "allowed", exit_code: 0 }), ctx)
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated", "item.updated"])
    expect(events.at(-1)).toMatchObject({
      item: {
        id: "claude-hook-hook-1", turnId: "turn-1", tool: "hook/PreToolUse", status: "ok",
        detail: { name: "PreToolUse:guard", output: "allowed", input: { event: "PreToolUse", exitCode: 0 } },
      },
    })
  })

  it("缺 started 的失败仍落当前轮，stdout 与 stderr 都不丢", () => {
    const { events, state, ctx } = setup()
    onHookMessage(state, hook("hook_response", {
      outcome: "error", stdout: "first", stderr: "second", exit_code: 2,
    }), ctx)
    expect(events).toEqual([expect.objectContaining({
      type: "item.started",
      item: expect.objectContaining({ status: "failed", error: "first\nsecond" }),
    })])
  })

  it("轮次外启动 Hook 失败进入会话状态，普通成功保持安静", () => {
    const { events, state, ctx } = setup(null)
    onHookMessage(state, hook("hook_started", { hook_event: "SessionStart" }), ctx)
    onHookMessage(state, hook("hook_response", {
      hook_event: "SessionStart", outcome: "error", stderr: "boot failed",
    }), ctx)
    onHookMessage(state, hook("hook_response", {
      hook_id: "hook-2", hook_event: "Setup", outcome: "success", output: "context",
    }), ctx)
    expect(events).toEqual([expect.objectContaining({
      type: "engine.status", status: "degraded", detail: "PreToolUse:guard\nboot failed",
    })])
  })

  it("会话关闭会终止已显示的悬空 Hook，未显示的不会复活", () => {
    vi.useFakeTimers()
    const { events, state, ctx } = setup()
    onHookMessage(state, hook("hook_started"), ctx)
    onHookMessage(state, hook("hook_started", { hook_id: "hook-hidden" }), ctx)
    vi.advanceTimersByTime(300)
    onHookMessage(state, hook("hook_started", { hook_id: "hook-late" }), ctx)
    closeHooks(state, ctx)
    vi.runAllTimers()
    expect(events.filter((event) => event.type === "item.started")).toHaveLength(2)
    expect(events.filter((event) => event.type === "item.updated")).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ status: "interrupted" }) }),
      expect.objectContaining({ item: expect.objectContaining({ status: "interrupted" }) }),
    ])
    expect(state.active.size).toBe(0)
  })
})
