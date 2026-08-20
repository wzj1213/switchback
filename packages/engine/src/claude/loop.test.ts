import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createPlanState } from "./plan.js"
import { createTaskState } from "./tasks.js"
import { runMessageLoop, type TurnRef } from "./loop.js"

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1",
    cwd: "/work",
    home: "/home/dev",
    trust: "auto-edit",
    memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
  }
}

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

describe("Claude 消息循环收尾", () => {
  it("result 成功但漏了 tool_result 时，不留下永远 running 的工具", async () => {
    const events: Event[] = []
    const ref: TurnRef = {
      current: "turn-1",
      seq: 0,
      tools: new Map(),
      tasks: createTaskState(),
      plan: createPlanState(),
    }
    await runMessageLoop(
      stream([
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "sleep 10" } }],
          },
        },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.find((event) => event.type === "item.updated")).toMatchObject({
      item: { id: "tool-1", status: "failed", error: expect.stringContaining("没有报告") },
    })
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1)
    expect(ref.tools.size).toBe(0)
  })
})
