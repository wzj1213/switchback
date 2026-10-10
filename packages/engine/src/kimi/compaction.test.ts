import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { KimiTurnTracker } from "./turn.js"
import { handleTurnEvent } from "./turn-events.js"
import type { KimiSnapshot } from "./wire.js"

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

  describe("压缩时断过线，重连的快照来对账", () => {
    const snapshot = (busy: boolean, flight = false): KimiSnapshot => ({
      as_of_seq: 9, epoch: "ep",
      session: { id: "s1", title: "", busy, metadata: { cwd: "/work" }, agent_config: {} },
      in_flight_turn: flight ? { turn_id: 8, assistant_text: "", thinking_text: "", running_tools: [] } : null,
      pending_approvals: [], pending_questions: [],
    })
    const cases = [
      { name: "请求已被接下、Kimi 空闲：压缩已经结束，照实说没收到结果", accepted: true, snap: snapshot(false), ends: ["completed"] },
      { name: "还在忙：接着等实时帧", accepted: true, snap: snapshot(true), ends: [] },
      { name: "请求还没回包：空闲快照说的是压缩开始之前", accepted: false, snap: snapshot(false), ends: [] },
      { name: "又有一轮在跑：不归这次压缩管", accepted: true, snap: snapshot(true, true), ends: [] },
    ]
    for (const one of cases) {
      it(one.name, () => {
        const events: Event[] = []
        const turn = tracker(events)
        const generation = turn.begin("compact-turn", "", "compact")
        handleTurnEvent(turn, { type: "compaction.started", trigger: "manual" }, 1)
        if (one.accepted) turn.activationAccepted(generation)
        turn.reconcile(one.snap)
        expect(events.flatMap((event) => event.type === "turn.completed" ? [event.status] : [])).toEqual(one.ends)
        if (one.ends.length > 0) {
          expect(events.at(-2)).toMatchObject({
            type: "item.updated",
            item: { id: "kimi-compaction-compact-turn", message: expect.stringContaining("没收到 Kimi 报的结果") },
          })
        }
      })
    }
  })
})
