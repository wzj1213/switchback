import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { KimiTurnEvents } from "./turn-events.js"
import { KimiTurnTracker } from "./turn.js"

describe("Kimi 其他原生客户端轮次", () => {
  it("普通用户轮实时接入宿主，并继续消费正文与终态", () => {
    const events: Event[] = []
    const starts: unknown[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, (turn) => {
      starts.push(turn)
      return "host-native"
    })

    handler.handle(
      {
        type: "turn.started",
        turnId: 12,
        origin: { kind: "user" },
        prompt: "来自 Kimi 原生端",
      },
      1,
    )
    handler.handle({ type: "assistant.delta", turnId: 12, delta: "已经接上" }, 2)
    handler.handle({ type: "turn.ended", turnId: 12, reason: "completed" }, 3)

    expect(starts).toEqual([{ at: 1, prompt: "来自 Kimi 原生端" }])
    expect(events).toMatchObject([
      {
        type: "item.started",
        item: { turnId: "host-native", kind: "agent_message", text: "已经接上" },
      },
      { type: "item.updated", item: { turnId: "host-native", complete: true } },
      { type: "turn.completed", turnId: "host-native", status: "completed" },
    ])
  })

  it("宿主拒绝认领时不把外部正文挂到别的轮次", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, () => undefined)

    handler.handle(
      { type: "turn.started", turnId: 12, origin: { kind: "user" }, prompt: "外部请求" },
      1,
    )
    handler.handle({ type: "assistant.delta", turnId: 12, delta: "不该串线" }, 2)

    expect(events).toEqual([])
    expect(tracker.hasActive()).toBe(false)
  })
})
