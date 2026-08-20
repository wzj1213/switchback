import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { handleTurnEvent, KimiTurnTracker } from "./turn.js"

describe("Kimi 轮次事件", () => {
  it("流式文本、命令输出和收工都落在宿主铸的同一轮上", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 99 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handleTurnEvent(tracker, { type: "thinking.delta", turnId: 7, delta: "想" }, 2)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 7, delta: "答" }, 3)
    handleTurnEvent(
      tracker,
      { type: "tool.call.started", turnId: 7, toolCallId: "tc", name: "Shell", display: { kind: "command", command: "echo ok" } },
      4,
    )
    handleTurnEvent(tracker, { type: "tool.progress", turnId: 7, toolCallId: "tc", update: { kind: "stdout", text: "o" } }, 5)
    handleTurnEvent(tracker, { type: "tool.result", turnId: 7, toolCallId: "tc", output: "ok", isError: false }, 6)
    handleTurnEvent(tracker, { type: "turn.ended", turnId: 7, reason: "completed" }, 7)

    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      { type: "turn.completed", at: 7, turnId: "omni-turn", status: "completed" },
    ])
    expect(events.filter((event) => event.type === "item.started").map((event) => event.item.kind)).toEqual([
      "reasoning",
      "agent_message",
      "tool_call",
    ])
    const tool = events.findLast((event) => event.type === "item.updated" && event.item.kind === "tool_call")
    expect(tool?.type === "item.updated" && tool.item.kind === "tool_call" ? tool.item : undefined).toMatchObject({
      id: "tc",
      status: "ok",
      detail: { kind: "shell", output: "ok" },
    })
  })

  it("不是当前原生 turn 的事件不会串进来", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "a")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "a" }, 1)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 2, delta: "别人的" }, 2)
    expect(events).toEqual([])
  })

  it("todo_list 原地更新成计划卡，不重复画成工具行", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "做事" }, 1)
    handleTurnEvent(
      tracker,
      {
        type: "tool.call.started",
        turnId: 1,
        toolCallId: "todo-1",
        name: "TodoWrite",
        display: { kind: "todo_list", items: [{ title: "先查", status: "in_progress" }] },
      },
      2,
    )
    handleTurnEvent(
      tracker,
      {
        type: "tool.call.started",
        turnId: 1,
        toolCallId: "todo-2",
        name: "TodoWrite",
        display: { kind: "todo_list", items: [{ title: "先查", status: "completed" }] },
      },
      3,
    )

    expect(events).toMatchObject([
      { type: "item.started", item: { id: "kimi-plan-omni-turn", kind: "plan", steps: [{ status: "in_progress" }] } },
      { type: "item.updated", item: { id: "kimi-plan-omni-turn", kind: "plan", steps: [{ status: "done" }] } },
    ])
  })
})
