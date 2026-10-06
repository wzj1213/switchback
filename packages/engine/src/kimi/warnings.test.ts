import type { Event } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { KimiTurnTracker } from "./turn.js"
import { emitKimiLiveWarning, emitKimiSessionWarnings } from "./warnings.js"

describe("Kimi 原生警告", () => {
  it("会话级警告按原生 code 原地换新，并保留三档严重度", () => {
    const events: Event[] = []
    emitKimiSessionWarnings([
      { code: "agents-md-oversized", message: "AGENTS.md too large", severity: "warning" },
      { code: "broken", message: "profile unavailable", severity: "error" },
      { code: "tip", message: "native hint", severity: "info" },
      { code: "bad", message: "ignored", severity: "unknown" },
    ], { threadId: "th-1", at: 7, emit: (event) => events.push(event) })

    expect(events).toMatchObject([
      { type: "engine.notification", engine: "kimi", key: "session-warning:agents-md-oversized", priority: "medium" },
      { type: "engine.notification", key: "session-warning:broken", priority: "high" },
      { type: "engine.notification", key: "session-warning:tip", priority: "low" },
    ])
  })

  it("轮次外实时 warning 走会话横幅，缺 code 仍不丢原文", () => {
    const events: Event[] = []
    emitKimiLiveWarning(
      { type: "warning", message: "native warning" },
      { threadId: "th-1", at: 8, emit: (event) => events.push(event) },
    )
    expect(events).toEqual([{
      type: "engine.notification",
      at: 8,
      threadId: "th-1",
      engine: "kimi",
      key: "session-warning:warning",
      message: "native warning",
      priority: "medium",
    }])
  })

  it("轮次内 warning 是提示而非致命错误，未绑定时明确交给会话层", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    expect(tracker.notice({ type: "warning", message: "too early" }, 1)).toBe(false)
    tracker.begin("turn-1", "做事")
    tracker.started({ type: "turn.started", turnId: 4, prompt: "做事" })
    expect(tracker.notice({ type: "warning", turnId: 4, message: "check this" }, 2)).toBe(true)
    expect(events).toEqual([{
      type: "item.started",
      at: 2,
      item: {
        id: "kimi-warning-turn-1-2-1",
        turnId: "turn-1",
        at: 2,
        kind: "notice",
        message: "check this",
        level: "warning",
      },
    }])
  })
})
