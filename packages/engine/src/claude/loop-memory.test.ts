import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

describe("Claude 消息循环记忆召回", () => {
  it("把公开 memory_recall 帧留在所属轮次", async () => {
    const events: Event[] = []
    const req: StartRequest = {
      threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit",
      memory: () => [], emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    }
    const ref = createTurnRef(() => undefined)
    ref.current = "turn-1"
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system", subtype: "memory_recall", mode: "select",
          memories: [{ path: "/home/dev/.claude/memory/rules.md", scope: "personal" }],
        }
        yield { type: "result", subtype: "success", is_error: false }
      },
    }

    await runMessageLoop(stream as never, req, ref, () => "auto-edit")

    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      item: {
        id: "turn-1:i1", turnId: "turn-1", kind: "notice",
        message: expect.stringContaining("/home/dev/.claude/memory/rules.md"),
      },
    })
  })
})
