import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import {
  isKimiGoalContinuation,
  KimiGoalContinuationBridge,
} from "./goal-continuation.js"
import type { KimiTranscriptTurn } from "./wire.js"
import { KimiTurnEvents } from "./turn-events.js"
import { KimiTurnTracker } from "./turn.js"

describe("Kimi 长期目标自动续轮来源", () => {
  it.each([
    { label: "实时来源", raw: { kind: "system_trigger", name: "goal_continuation" }, want: true },
    {
      label: "transcript 来源",
      raw: { kind: "other", payload: { kind: "system_trigger", name: "goal_continuation" } },
      want: true,
    },
    { label: "其他系统触发", raw: { kind: "system_trigger", name: "stop_hook" }, want: false },
    { label: "普通用户", raw: { kind: "user" }, want: false },
  ])("识别 $label", ({ raw, want }) => {
    expect(isKimiGoalContinuation(raw)).toBe(want)
  })

  it("恢复时只提交空边界和公开来源，不提交 Kimi 的内部续跑提示", () => {
    const starts: unknown[] = []
    const bridge = new KimiGoalContinuationBridge((turn) => {
      starts.push(turn)
      return "host-goal"
    })
    const turn: KimiTranscriptTurn = {
      kind: "turn",
      turnId: "t8",
      state: "running",
      origin: { kind: "other", payload: { kind: "system_trigger", name: "goal_continuation" } },
      steps: [],
    }

    expect(bridge.recover(turn, 8, 11)).toEqual({ native: 8, turnId: "host-goal", prompt: "" })
    expect(starts).toEqual([{ at: 11, prompt: "", origin: { kind: "goal_continuation" } }])
  })

  it("目标自动续轮沿用同一宿主轮，不在原生轮间提前收工", () => {
    const events: Event[] = []
    let active = true
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, undefined, () => active)
    tracker.begin("host-turn", "/write-goal 完成发布")

    handler.handle({ type: "turn.started", turnId: 1, origin: { kind: "user" }, prompt: "/write-goal 完成发布" }, 1)
    handler.handle({ type: "assistant.delta", turnId: 1, delta: "先完成一部分" }, 2)
    handler.handle({ type: "turn.ended", turnId: 1, reason: "completed" }, 3)

    expect(tracker.isAwaitingContinuation()).toBe(true)
    expect(events.some((event) => event.type === "turn.completed")).toBe(false)

    handler.handle(
      { type: "turn.started", turnId: 2, origin: { kind: "system_trigger", name: "goal_continuation" } },
      4,
    )
    handler.handle({ type: "assistant.delta", turnId: 2, delta: "再完成一部分" }, 5)
    active = false
    handler.goalChanged(false, 6)
    handler.handle({ type: "turn.ended", turnId: 2, reason: "completed" }, 7)

    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      { type: "turn.completed", at: 7, turnId: "host-turn", status: "completed" },
    ])
    expect(events.slice(0, 4)).toMatchObject([
      { type: "item.started", item: { id: "kimi-answer-host-turn", text: "先完成一部分" } },
      { type: "item.updated", item: { id: "kimi-answer-host-turn", complete: true } },
      {
        type: "item.started",
        item: { kind: "user_message", text: "", origin: { kind: "goal_continuation" } },
      },
      { type: "item.started", item: { id: "kimi-answer-host-turn-2", text: "再完成一部分" } },
    ])
  })

  it("原生轮结束后目标转为非活动时，交还同一宿主轮", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, undefined, () => true)
    tracker.begin("host-turn", "开始目标")
    handler.handle({ type: "turn.started", turnId: 1, prompt: "开始目标" }, 1)
    handler.handle({ type: "turn.ended", turnId: 1, reason: "completed" }, 2)

    handler.goalChanged(false, 3)

    expect(events.at(-1)).toEqual({
      type: "turn.completed",
      at: 3,
      turnId: "host-turn",
      status: "completed",
    })
    expect(tracker.hasActive()).toBe(false)
  })

  it("原生 turn 达到公开的单轮步数上限时等待目标续轮，而不是把宿主轮报失败", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, undefined, () => true)
    tracker.begin("host-turn", "继续目标")
    handler.handle({ type: "turn.started", turnId: 1, prompt: "继续目标" }, 1)

    handler.handle(
      { type: "turn.ended", turnId: 1, reason: "failed", interruptReason: "max_steps" },
      2,
    )

    expect(tracker.isAwaitingContinuation()).toBe(true)
    expect(events.some((event) => event.type === "turn.completed")).toBe(false)
  })

  it("不同目标续轮的计划使用不同 item 身份，不覆盖上一段历史", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, undefined, () => true)
    const plan = (turnId: number, title: string) => handler.handle({
      type: "tool.call.started",
      turnId,
      toolCallId: `plan-${String(turnId)}`,
      name: "TodoWrite",
      display: { kind: "todo_list", items: [{ title, status: "in_progress" }] },
    }, turnId)
    tracker.begin("host-turn", "开始目标")
    handler.handle({ type: "turn.started", turnId: 1, prompt: "开始目标" }, 1)
    plan(1, "第一段")
    handler.handle({ type: "turn.ended", turnId: 1, reason: "completed" }, 2)
    handler.handle(
      { type: "turn.started", turnId: 2, origin: { kind: "system_trigger", name: "goal_continuation" } },
      3,
    )
    plan(2, "第二段")

    expect(events.filter((event) => event.type === "item.started")).toMatchObject([
      { item: { id: "kimi-plan-host-turn", kind: "plan" } },
      { item: { origin: { kind: "goal_continuation" } } },
      { item: { id: "kimi-plan-host-turn-2", kind: "plan" } },
    ])
  })
})
