import { describe, expect, it } from "vitest"
import { toTranscript } from "./transcript.js"

describe("Kimi transcript", () => {
  it("同一轮多次 todo_list 只留下最后一版计划", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "7",
          state: "completed",
          steps: [
            {
              frames: [
                {
                  kind: "tool",
                  frameId: "f1",
                  toolCallId: "tc1",
                  name: "TodoWrite",
                  state: "done",
                  display: { kind: "todo_list", items: [{ title: "查", status: "in_progress" }] },
                },
                {
                  kind: "tool",
                  frameId: "f2",
                  toolCallId: "tc2",
                  name: "TodoWrite",
                  state: "done",
                  display: { kind: "todo_list", items: [{ title: "查", status: "completed" }] },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(got).toMatchObject({
      total: 1,
      items: [{ id: "kimi-history-7-plan", kind: "plan", steps: [{ text: "查", status: "done" }] }],
    })
  })
})
