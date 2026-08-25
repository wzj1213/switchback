import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createPlanState } from "./plan.js"
import { createStream } from "./stream.js"
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

describe("逐字与收尾的身份对齐", () => {
  it("**流式那条和收尾那条是同一条 item**，转录区里不会留下两条一样的消息", async () => {
    const events: Event[] = []
    const ref: TurnRef = {
      current: "turn-1",
      seq: 0,
      tools: new Map(),
      tasks: createTaskState(),
      plan: createPlanState(),
      stream: createStream(),
    }
    await runMessageLoop(
      stream([
        { type: "stream_event", event: { type: "message_start" } },
        { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
        { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你" } } },
        { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好" } } },
        { type: "assistant", message: { content: [{ type: "text", text: "你好" }] } },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      { trust: () => "auto-edit", window: () => undefined, onReady: () => undefined },
    )
    const started = events.filter((e) => e.type === "item.started")
    // 两条 `item.started`：一条开流、一条收尾——**但 id 只有一个**，
    // store 的归约器按 id 幂等，于是收尾那条是原地替换（见 `stream.ts`）
    expect(started).toHaveLength(2)
    expect(new Set(started.map((e) => (e.type === "item.started" ? e.item.id : "")))).toEqual(new Set(["turn-1:i1"]))
    expect(started[0]).toMatchObject({ item: { text: "", complete: false } })
    expect(started[1]).toMatchObject({ item: { text: "你好", complete: true } })
    expect(events.filter((e) => e.type === "item.delta")).toHaveLength(2)
  })

  it("待办工具夹在中间也不会让序号错位——那一族是被滤掉之后才翻译的", async () => {
    const events: Event[] = []
    const ref: TurnRef = {
      current: "turn-1",
      seq: 0,
      tools: new Map(),
      tasks: createTaskState(),
      plan: createPlanState(),
      stream: createStream(),
    }
    await runMessageLoop(
      stream([
        { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
        { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "先说一句" } } },
        { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use" } } },
        { type: "stream_event", event: { type: "content_block_start", index: 2, content_block: { type: "text" } } },
        { type: "stream_event", event: { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "再说一句" } } },
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "先说一句" },
              { type: "tool_use", id: "todo-1", name: "TodoWrite", input: { todos: [] } },
              { type: "text", text: "再说一句" },
            ],
          },
        },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      { trust: () => "auto-edit", window: () => undefined, onReady: () => undefined },
    )
    const texts = events
      .filter((e) => e.type === "item.started")
      .map((e) => (e.type === "item.started" ? e.item : undefined))
      .filter((item) => item?.kind === "agent_message")
    // 两句各自一条 item，一共两个 id——错位的话「再说一句」会另起一条新的
    expect(new Set(texts.map((item) => item?.id))).toEqual(new Set(["turn-1:i1", "turn-1:i2"]))
  })
})

describe("Claude 消息循环收尾", () => {
  it("result 成功但漏了 tool_result 时，不留下永远 running 的工具", async () => {
    const events: Event[] = []
    const ref: TurnRef = {
      current: "turn-1",
      seq: 0,
      tools: new Map(),
      tasks: createTaskState(),
      plan: createPlanState(),
    stream: createStream(),
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
      { trust: () => "auto-edit", window: () => undefined, onReady: () => undefined },
    )

    expect(events.find((event) => event.type === "item.updated")).toMatchObject({
      item: { id: "tool-1", status: "failed", error: expect.stringContaining("没有报告") },
    })
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1)
    expect(ref.tools.size).toBe(0)
  })
})
