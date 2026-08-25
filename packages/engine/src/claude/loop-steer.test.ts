import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { capabilitiesOf } from "./caps.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

const stream = (messages: readonly unknown[]): never => ({
  async *[Symbol.asyncIterator]() {
    for (const message of messages) yield message
  },
}) as never

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-steer", cwd: "/work", home: "/home/dev", trust: "auto-edit",
    memory: () => [], emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude 原生 steer 的阶段折叠", () => {
  it("只有接通原生插话并钉过活体测试后才对宿主报 true", () => {
    expect(capabilitiesOf(undefined).steer).toBe(true)
  })

  it("被打断 result 不收工，插话后的 result 才让同一个 omni turn 收工", async () => {
    const events: Event[] = []
    const ref = createTurnRef(() => undefined)
    ref.current = "turn-steer"
    ref.pendingSteers = 1

    await runMessageLoop(stream([
      {
        type: "assistant", parent_tool_use_id: null,
        message: {
          usage: { input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 3 },
          content: [{ type: "text", text: "1\n2\n3" }],
        },
      },
      { type: "result", subtype: "success", is_error: false, usage: { output_tokens: 3 } },
      { type: "system", subtype: "init", session_id: "same-session" },
      {
        type: "assistant", parent_tool_use_id: null,
        message: {
          usage: { input_tokens: 12, cache_read_input_tokens: 7, output_tokens: 2 },
          content: [{ type: "text", text: "STEER_OK" }],
        },
      },
      {
        type: "result", subtype: "success", is_error: false,
        usage: { input_tokens: 999, cache_read_input_tokens: 888, output_tokens: 2 },
      },
    ]), request(events), ref, {
      trust: () => "auto-edit",
      context: () => Promise.resolve({ totalTokens: 41, maxTokens: 1000 }),
      onReady: () => undefined,
    })

    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      { type: "turn.completed", at: expect.any(Number), turnId: "turn-steer", status: "completed" },
    ])
    expect(events.filter((event) => event.type === "item.started").map((event) =>
      event.type === "item.started" && event.item.kind === "agent_message" ? event.item.text : undefined,
    ).filter(Boolean)).toEqual(["1\n2\n3", "STEER_OK"])
    expect(events.find((event) => event.type === "usage.updated")).toMatchObject({
      usage: { contextUsed: 41, contextWindow: 1000, outputTokens: 5, cacheRead: 7 },
    })
    expect(ref.current).toBeUndefined()
    expect(ref.pendingSteers).toBe(0)
  })
})
