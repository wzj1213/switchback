import type { Event } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { KimiTurnEvents } from "./turn-events.js"
import { KimiTurnTracker } from "./turn.js"
import { kimiStepInterruptionMessage } from "./step-outcome.js"

function setup(): { events: Event[]; handler: KimiTurnEvents } {
  const events: Event[] = []
  const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 99 })
  tracker.begin("switchback-turn", "做事")
  return { events, handler: new KimiTurnEvents(tracker, undefined) }
}

describe("Kimi step 结论", () => {
  it("按 Kimi 原生界面语义翻译 step 中断原因", () => {
    const cases = [
      [{ reason: "error" }, undefined],
      [{ reason: "aborted" }, "Interrupted by user"],
      [{ reason: "aborted", message: "Stopped by operator" }, "Stopped by operator"],
      [{ reason: "max_steps" }, "reached per-turn step limit (max_steps)"],
      [{ reason: "provider_reset" }, "step interrupted (provider_reset)"],
    ] as const
    for (const [payload, expected] of cases) {
      expect(kimiStepInterruptionMessage(payload)).toBe(expected)
    }
  })

  it("实时中断收口正文并且重放不重复提示", () => {
    const { events, handler } = setup()
    handler.handle({ type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handler.handle({ type: "turn.step.started", turnId: 7, step: 1 }, 2)
    handler.handle({ type: "assistant.delta", turnId: 7, delta: "半截回答" }, 3)
    const interrupted = {
      type: "turn.step.interrupted",
      turnId: 7,
      step: 1,
      reason: "aborted",
    } as const
    handler.handle(interrupted, 4)
    handler.handle(interrupted, 5)

    expect(events).toContainEqual({
      type: "item.started",
      at: 4,
      item: {
        id: "kimi-error-switchback-turn-4-1",
        turnId: "switchback-turn",
        at: 4,
        kind: "error",
        message: "Interrupted by user",
        fatal: false,
      },
    })
    expect(events.filter((event) => event.type === "item.started")).toHaveLength(2)
  })

  it("max_tokens 没产出工具调用时保留原生截断提示", () => {
    const { events, handler } = setup()
    handler.handle({ type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handler.handle({ type: "turn.step.started", turnId: 7, step: 1 }, 2)
    handler.handle({ type: "assistant.delta", turnId: 7, delta: "半截回答" }, 3)
    handler.handle(
      { type: "turn.step.completed", turnId: 7, step: 1, finishReason: "max_tokens" },
      4,
    )
    handler.handle({ type: "turn.ended", turnId: 7, reason: "completed" }, 5)

    expect(events).toContainEqual({
      type: "item.started",
      at: 4,
      item: {
        id: "kimi-warning-switchback-turn-4-1",
        turnId: "switchback-turn",
        at: 4,
        kind: "notice",
        message: "Model hit max_tokens — no tool call was emitted.",
        level: "warning",
      },
    })
    expect(events.at(-1)).toEqual({
      type: "turn.completed",
      at: 5,
      turnId: "switchback-turn",
      status: "completed",
    })
  })

  it("provider 过滤时保留原生标题和原始结论", () => {
    const { events, handler } = setup()
    handler.handle({ type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handler.handle({ type: "turn.step.started", turnId: 7, step: 1 }, 2)
    handler.handle(
      {
        type: "turn.step.completed",
        turnId: 7,
        step: 1,
        finishReason: "filtered",
        providerFinishReason: "filtered",
        rawFinishReason: "content_filter",
      },
      3,
    )

    expect(events).toContainEqual({
      type: "item.started",
      at: 3,
      item: {
        id: "kimi-warning-switchback-turn-3-1",
        turnId: "switchback-turn",
        at: 3,
        kind: "notice",
        message:
          "Provider safety policy blocked the response.\nThe model output was filtered (content_filter).",
        level: "warning",
      },
    })
  })

  it("同一 step 被 transcript 二次恢复时不重复报告 max_tokens", () => {
    const { events, handler } = setup()
    handler.handle({ type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handler.handle({ type: "turn.step.started", turnId: 7, step: 1 }, 2)
    const completed = {
      type: "turn.step.completed",
      turnId: 7,
      step: 1,
      finishReason: "max_tokens",
    } as const

    handler.handle(completed, 3)
    handler.handle({ type: "turn.step.started", turnId: 7, step: 1 }, 4)
    handler.handle(completed, 5)

    expect(
      events.filter((event) => event.type === "item.started" && event.item.kind === "notice"),
    ).toHaveLength(1)
  })

  it("未形成正式调用的工具参数流使用 Kimi 的专用截断说明", () => {
    const { events, handler } = setup()
    handler.handle({ type: "turn.started", turnId: 8, prompt: "做事" }, 1)
    handler.handle({ type: "turn.step.started", turnId: 8, step: 1 }, 2)
    handler.handle(
      {
        type: "tool.call.delta",
        turnId: 8,
        toolCallId: "partial",
        name: "Shell",
        argumentsPart: '{"',
      },
      3,
    )
    handler.handle(
      { type: "turn.step.completed", turnId: 8, step: 1, finishReason: "max_tokens" },
      4,
    )

    expect(events).toMatchObject([
      {
        type: "item.started",
        item: {
          id: "partial",
          kind: "tool_call",
          tool: "Shell",
          status: "running",
          detail: { kind: "other", input: '{"' },
        },
      },
      {
        type: "item.updated",
        item: {
          id: "partial",
          kind: "tool_call",
          status: "failed",
          error: "Model hit max_tokens — tool call was truncated before it could run.",
        },
      },
      {
        type: "item.started",
        at: 4,
        item: {
          id: "kimi-warning-switchback-turn-4-1",
          turnId: "switchback-turn",
          at: 4,
          kind: "notice",
          message: "Model hit max_tokens — tool call was truncated before it could run.",
          level: "warning",
        },
      },
    ])
  })
})
