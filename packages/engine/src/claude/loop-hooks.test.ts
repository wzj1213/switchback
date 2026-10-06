import { afterEach, describe, expect, it, vi } from "vitest"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

afterEach(() => vi.useRealTimers())

describe("Claude 消息循环的 Hook 路由", () => {
  it("把公开起止帧送进同一个原生 Hook 工具项", async () => {
    vi.useFakeTimers()
    const events: Event[] = []
    const ref = createTurnRef(() => undefined)
    ref.current = "turn-hook"
    const handle = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system", subtype: "hook_started", hook_id: "native-1",
          hook_name: "UserPromptSubmit:audit", hook_event: "UserPromptSubmit",
        }
        await vi.advanceTimersByTimeAsync(300)
        yield {
          type: "system", subtype: "hook_response", hook_id: "native-1",
          hook_name: "UserPromptSubmit:audit", hook_event: "UserPromptSubmit",
          outcome: "success", output: "checked", stdout: "checked", stderr: "", exit_code: 0,
        }
        yield { type: "result", subtype: "success", is_error: false }
      },
    } as never
    await runMessageLoop(handle, request(events), ref, () => "auto-edit")

    expect(events.filter((event) => event.type === "item.started" || event.type === "item.updated"))
      .toMatchObject([
        { type: "item.started", item: { id: "claude-hook-native-1", status: "running" } },
        { type: "item.updated", item: { id: "claude-hook-native-1", status: "ok", detail: { output: "checked" } } },
      ])
  })
})
