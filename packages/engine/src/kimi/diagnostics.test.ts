import type { Event } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { KimiDiagnostics } from "./diagnostics.js"

function errors(): { tracker: KimiDiagnostics; events: Event[] } {
  const events: Event[] = []
  return { tracker: new KimiDiagnostics({ threadId: "thread-1", emit: (event) => events.push(event) }), events }
}

describe("Kimi 会话错误", () => {
  it("轮次失败后紧邻的同内容 error 是原生副本，不重复弹横幅", () => {
    const out = errors()
    const error = { code: "provider.auth_error", message: "401 rejected", retryable: false }
    expect(out.tracker.handle({ type: "turn.ended", reason: "failed", error }, 8, 9)).toBe(false)
    expect(out.tracker.handle({ type: "error", ...error }, 9, 10)).toBe(true)
    expect(out.events).toEqual([])
  })

  it("压缩等轮次外错误按原生格式显示，序号不相邻时也不误去重", () => {
    const out = errors()
    const error = { code: "provider.auth_error", message: "401 rejected", retryable: false }
    out.tracker.handle({ type: "turn.ended", reason: "failed", error }, 8, 9)
    out.tracker.handle({ type: "error", ...error }, 17, 12)
    expect(out.events).toEqual([{
      type: "engine.notification",
      at: 17,
      threadId: "thread-1",
      engine: "kimi",
      key: "session-error:provider.auth_error",
      message: "[provider.auth_error] 401 rejected",
      priority: "high",
    }])
  })

  it("provider filtered 沿用 Kimi TUI 对 details 的安全说明", () => {
    const out = errors()
    out.tracker.handle({
      type: "error",
      code: "provider.filtered",
      message: "raw provider text",
      retryable: false,
      details: { finishReason: "filtered", rawFinishReason: "content_filter" },
    }, 20, 20)
    expect(out.events[0]).toMatchObject({
      message: "[provider.filtered] Provider filtered the response before visible output (finishReason=filtered, rawFinishReason=content_filter).",
    })
  })
})
