import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit",
    memory: () => [], emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

function stream(messages: readonly unknown[]): never {
  return { async *[Symbol.asyncIterator]() { for (const message of messages) yield message } } as never
}

function ref(): ReturnType<typeof createTurnRef> {
  const out = createTurnRef(() => undefined)
  out.current = "turn-1"
  return out
}

const options = {
  trust: () => "auto-edit" as const,
  context: () => Promise.resolve(undefined),
  onReady: () => undefined,
}

describe("Claude 逐字与收尾的身份对齐", () => {
  it("流式消息与完整收尾复用同一个 item", async () => {
    const events: Event[] = []
    await runMessageLoop(stream([
      { type: "stream_event", event: { type: "message_start" } },
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好" } } },
      { type: "assistant", message: { content: [{ type: "text", text: "你好" }] } },
      { type: "result", subtype: "success", is_error: false },
    ]), request(events), ref(), options)

    const started = events.filter((event) => event.type === "item.started")
    expect(started).toHaveLength(2)
    expect(new Set(started.map((event) => event.item.id))).toEqual(new Set(["turn-1:i1"]))
    expect(events.filter((event) => event.type === "item.delta")).toHaveLength(2)
  })

  it("待办工具夹在两个文本块之间也不打乱身份", async () => {
    const events: Event[] = []
    await runMessageLoop(stream([
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "先说" } } },
      { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use" } } },
      { type: "stream_event", event: { type: "content_block_start", index: 2, content_block: { type: "text" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "再说" } } },
      { type: "assistant", message: { content: [
        { type: "text", text: "先说" },
        { type: "tool_use", id: "todo-1", name: "TodoWrite", input: { todos: [] } },
        { type: "text", text: "再说" },
      ] } },
      { type: "result", subtype: "success", is_error: false },
    ]), request(events), ref(), options)

    const ids = events.filter((event) => event.type === "item.started")
      .filter((event) => event.item.kind === "agent_message").map((event) => event.item.id)
    expect(new Set(ids)).toEqual(new Set(["turn-1:i1", "turn-1:i2"]))
  })
})
