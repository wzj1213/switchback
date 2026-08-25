import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude 本地斜杠命令输出", () => {
  it("只把当前轮的非空原生输出作为完整助手样式文本保留", async () => {
    const events: Event[] = []
    const ref = createTurnRef(() => undefined)
    ref.current = "turn-command"
    await runMessageLoop(stream([
      { type: "system", subtype: "local_command_output", content: "Usage: 42%" },
      { type: "system", subtype: "local_command_output", content: "" },
      { type: "result", subtype: "success", is_error: false },
      { type: "system", subtype: "local_command_output", content: "late" },
    ]), request(events), ref, () => "auto-edit")

    expect(events.filter((event) => event.type === "item.started")).toEqual([{
      type: "item.started",
      at: expect.any(Number),
      item: {
        id: "turn-command:i1", turnId: "turn-command", at: expect.any(Number),
        kind: "agent_message", text: "Usage: 42%", complete: true,
      },
    }])
  })
})
