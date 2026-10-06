import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { KimiTurnTracker } from "./turn.js"
import { handleTurnEvent } from "./turn-events.js"

function tracker(events: Event[]): KimiTurnTracker {
  return new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 99 })
}

const result = {
  summary: "内部摘要",
  compactedCount: 12,
  tokensBefore: 48_000,
  tokensAfter: 8_000,
}

describe("Kimi 上下文压缩", () => {
  it("手动压缩用同一条提示报告开始与结果，并收掉宿主轮次", () => {
    const events: Event[] = []
    const turn = tracker(events)
    turn.begin("compact-turn", "", "compact")
    handleTurnEvent(turn, { type: "compaction.started", trigger: "manual" }, 1)
    handleTurnEvent(turn, { type: "compaction.completed", trigger: "manual", result }, 2)

    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated", "turn.completed"])
    expect(events).toMatchObject([
      { item: { id: "kimi-compaction-compact-turn", kind: "notice", message: "正在压缩上下文…" } },
      { item: { id: "kimi-compaction-compact-turn", message: "上下文已压缩：12 条消息，48000 → 8000 tokens。" } },
      { turnId: "compact-turn", status: "completed" },
    ])
  })

  it("自动压缩只分隔当前回答，不提前结束模型还在跑的那一轮", () => {
    const events: Event[] = []
    const turn = tracker(events)
    turn.begin("prompt-turn", "继续")
    handleTurnEvent(turn, { type: "turn.started", turnId: 7, prompt: "继续" }, 1)
    handleTurnEvent(turn, { type: "assistant.delta", turnId: 7, delta: "前" }, 2)
    handleTurnEvent(turn, { type: "compaction.started", trigger: "auto" }, 3)
    handleTurnEvent(turn, { type: "compaction.blocked", turnId: 7 }, 4)
    handleTurnEvent(turn, { type: "compaction.completed", trigger: "auto", result }, 5)
    expect(turn.hasActive()).toBe(true)
    handleTurnEvent(turn, { type: "assistant.delta", turnId: 7, delta: "后" }, 6)
    handleTurnEvent(turn, { type: "turn.ended", turnId: 7, reason: "completed" }, 7)

    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1)
    const started = events.flatMap((event) => event.type === "item.started" ? [event.item] : [])
    expect(started.map((item) => item.kind)).toEqual(["agent_message", "notice", "agent_message"])
    expect(
      events.flatMap((event) =>
        event.type === "item.updated" && event.item.kind === "notice"
          ? [event.item.message]
          : [],
      ),
    ).toEqual([
      "Compaction is blocked by the current turn; retry when the turn is idle.",
      "上下文已压缩：12 条消息，48000 → 8000 tokens。",
    ])
  })

  it("手动压缩被取消会明确提示并以 interrupted 收工", () => {
    const events: Event[] = []
    const turn = tracker(events)
    turn.begin("compact-turn", "", "compact")
    handleTurnEvent(turn, { type: "compaction.started", trigger: "manual" }, 1)
    handleTurnEvent(turn, { type: "compaction.cancelled" }, 2)
    expect(events.at(-2)).toMatchObject({ item: { message: "上下文压缩已取消。", level: "notice" } })
    expect(events.at(-1)).toEqual({
      type: "turn.completed",
      at: 2,
      turnId: "compact-turn",
      status: "interrupted",
    })
  })
})
