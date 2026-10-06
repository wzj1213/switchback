import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { emitConversationReset } from "./conversation.js"

function run(raw: unknown, turnId: string | null = "turn-1"): Event[] {
  const events: Event[] = []
  emitConversationReset(raw, {
    threadId: "thread-1",
    ...(turnId === null ? {} : { turnId }),
    at: 7,
    nextId: () => "reset-note",
    emit: (event) => events.push(event),
  })
  return events
}

describe("Claude 清空原生上下文", () => {
  it("当前轮留下分界，同时清掉旧上下文用量", () => {
    expect(run({ new_conversation_id: "conversation-2" })).toEqual([
      { type: "usage.cleared", at: 7, threadId: "thread-1", engine: "claude" },
      {
        type: "item.started",
        at: 7,
        item: {
          id: "reset-note",
          turnId: "turn-1",
          at: 7,
          kind: "notice",
          level: "notice",
          message: "Claude 已清空上下文；上方记录仍保留供你查看，但后续回答不会再读取它。",
        },
      },
    ])
  })

  it("开场自己的 fresh-session reset 没有宿主轮次，只清用量不编一条转录", () => {
    expect(run({ new_conversation_id: "conversation-2" }, null)).toEqual([
      { type: "usage.cleared", at: 7, threadId: "thread-1", engine: "claude" },
    ])
  })

  it.each([undefined, null, {}, { new_conversation_id: 42 }, { new_conversation_id: "" }])(
    "认不出的形状不产生半次 reset：%j",
    (raw) => expect(run(raw)).toEqual([]),
  )
})
