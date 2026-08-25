import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

const stream = (messages: readonly unknown[]): never => ({
  async *[Symbol.asyncIterator]() {
    for (const message of messages) yield message
  },
}) as never

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-task", cwd: "/work", home: "/home/dev", trust: "auto-edit",
    memory: () => [], emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude 子 agent 旁路", () => {
  it("把原生 sidechain 的正文与工具归到 task lane，不混进主线也不误判失败", async () => {
    const events: Event[] = []
    const ref = createTurnRef(() => undefined)
    ref.current = "turn-task"
    await runMessageLoop(stream([
      {
        type: "assistant", parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "task-1", name: "Task", input: { prompt: "调研" } }] },
      },
      {
        type: "system", subtype: "task_started", task_id: "agent-a", tool_use_id: "task-1",
        description: "调研资料",
      },
      {
        type: "assistant", parent_tool_use_id: "task-1",
        message: { content: [{ type: "tool_use", id: "web-1", name: "WebSearch", input: { query: "资料" } }] },
      },
      {
        type: "user", parent_tool_use_id: "task-1",
        message: { content: [{ type: "tool_result", tool_use_id: "web-1", content: "找到" }] },
      },
      { type: "stream_event", parent_tool_use_id: "task-1", event: { type: "message_start" } },
      {
        type: "stream_event", parent_tool_use_id: "task-1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      },
      {
        type: "stream_event", parent_tool_use_id: "task-1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "旁路文字" } },
      },
      {
        type: "assistant", parent_tool_use_id: "task-1",
        message: { content: [{ type: "text", text: "旁路文字" }] },
      },
      {
        type: "user", parent_tool_use_id: null,
        message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "调研完成" }] },
      },
      {
        type: "system", subtype: "task_notification", task_id: "agent-a", tool_use_id: "task-1",
        status: "completed", summary: "调研完成",
      },
      { type: "result", subtype: "success", is_error: false },
    ]), request(events), ref, () => "auto-edit")

    const items = events.flatMap((event) =>
      event.type === "item.started" || event.type === "item.updated" ? [event.item] : [],
    )
    const web = items.findLast((item) => item.kind === "tool_call" && item.tool === "WebSearch")
    const answer = items.findLast((item) => item.kind === "agent_message" && item.text === "旁路文字")
    expect(web).toMatchObject({ id: "web-1", status: "ok", lane: { id: "agent-a", originItemId: "task-1" } })
    expect(answer).toMatchObject({ complete: true, lane: { id: "agent-a", originItemId: "task-1" } })
    const task = items.findLast((item) => item.id === "task-1")
    expect(task).toMatchObject({ status: "ok" })
    expect(task?.lane).toBeUndefined()
  })

  it("没有 task/tool_use 的权威对应时不猜一条 lane", async () => {
    const events: Event[] = []
    const ref = createTurnRef(() => undefined)
    ref.current = "turn-task"
    await runMessageLoop(stream([
      {
        type: "assistant", parent_tool_use_id: "unknown",
        message: { content: [{ type: "text", text: "不能归档" }] },
      },
      { type: "result", subtype: "success", is_error: false },
    ]), request(events), ref, () => "auto-edit")
    expect(events.some((event) =>
      (event.type === "item.started" || event.type === "item.updated")
      && event.item.kind === "agent_message" && event.item.text === "不能归档",
    )).toBe(false)
  })
})
