import type { Event } from "@omni/protocol"
import { describe, expect, it } from "vitest"
import { kimiHookResult } from "./hook-result.js"
import { KimiTurnTracker } from "./turn.js"
import { handleTurnEvent } from "./turn-events.js"

describe("Kimi UserPromptSubmit Hook 结果", () => {
  it("严格复用 Kimi 自己的 markdown 标题、blocked 标记与空结果占位", () => {
    const cases = [
      {
        payload: { type: "hook.result", hookEvent: "UserPromptSubmit", content: "  policy note  " },
        text: "*UserPromptSubmit hook*\n\npolicy note",
      },
      {
        payload: { type: "hook.result", hookEvent: "UserPromptSubmit", content: "", blocked: true },
        text: "*UserPromptSubmit hook blocked*\n\n(empty)",
      },
    ] as const
    for (const [index, row] of cases.entries()) {
      expect(kimiHookResult(row.payload, "turn-1", 7, index + 1)).toMatchObject({
        kind: "agent_message", text: row.text, complete: true,
      })
    }
  })

  it("Hook 结果切断流式正文成为独立条目，畸形与别轮事件不落记录", () => {
    const events: Event[] = []
    const turn = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    turn.begin("turn-1", "检查")
    handleTurnEvent(turn, { type: "turn.started", turnId: 5, prompt: "检查" }, 1)
    handleTurnEvent(turn, { type: "assistant.delta", turnId: 5, delta: "前文" }, 2)
    handleTurnEvent(turn, {
      type: "hook.result", turnId: 5, hookEvent: "UserPromptSubmit", content: "native result",
    }, 3)
    handleTurnEvent(turn, { type: "assistant.delta", turnId: 5, delta: "后文" }, 4)
    handleTurnEvent(turn, { type: "hook.result", turnId: 6, hookEvent: "Other", content: "wrong" }, 5)
    handleTurnEvent(turn, { type: "hook.result", hookEvent: "Late", content: "missing turn" }, 6)

    const items = events.flatMap((event) => event.type === "item.started" ? [event.item] : [])
    expect(items.map((item) => item.kind)).toEqual(["agent_message", "agent_message", "agent_message"])
    expect(items.map((item) => item.id)).toEqual([
      "kimi-answer-turn-1", "kimi-hook-turn-1-1", "kimi-answer-turn-1-2",
    ])
  })
})
