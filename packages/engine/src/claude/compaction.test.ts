import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

function run(messages: readonly unknown[]): Promise<Event[]> {
  const events: Event[] = []
  const req: StartRequest = {
    threadId: "thread-compact",
    cwd: "/work",
    home: "/home/dev",
    trust: "auto-edit",
    memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
  const ref = createTurnRef(() => undefined)
  ref.current = "turn-compact"
  return runMessageLoop(stream(messages), req, ref, () => "auto-edit").then(() => events)
}

describe("Claude 上下文压缩", () => {
  it("用同一条提示接住开始、成功与原生 token 边界", async () => {
    const events = await run([
      { type: "system", subtype: "status", status: "compacting" },
      { type: "system", subtype: "status", status: null, compact_result: "success" },
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "manual", pre_tokens: 44553, post_tokens: 3209 },
      },
      { type: "result", subtype: "success", is_error: false },
    ])
    const items = events.filter((event) => event.type === "item.started" || event.type === "item.updated")
    expect(items.map((event) => event.type)).toEqual(["item.started", "item.updated", "item.updated"])
    expect(items).toMatchObject([
      { item: { id: "claude-compaction-turn-compact", message: "正在压缩上下文…" } },
      { item: { id: "claude-compaction-turn-compact", message: "上下文已压缩。" } },
      { item: { id: "claude-compaction-turn-compact", message: "上下文已压缩：44553 → 3209 tokens。" } },
    ])
  })

  it("保留失败原文并压掉随后重复的 synthetic assistant", async () => {
    const events = await run([
      { type: "system", subtype: "status", status: "compacting" },
      {
        type: "system",
        subtype: "status",
        status: null,
        compact_result: "failed",
        compact_error: "Not enough messages to compact.",
      },
      {
        type: "assistant",
        message: {
          model: "<synthetic>",
          content: [{ type: "text", text: "Error: Not enough messages to compact." }],
        },
      },
      { type: "result", subtype: "success", is_error: false },
    ])
    expect(events.filter((event) => event.type === "item.started" || event.type === "item.updated"))
      .toMatchObject([
        { type: "item.started", item: { message: "正在压缩上下文…", level: "info" } },
        {
          type: "item.updated",
          item: { message: "上下文压缩未完成：Not enough messages to compact.", level: "notice" },
        },
      ])
    expect(events.some((event) => event.type === "item.started" && event.item.kind === "agent_message"))
      .toBe(false)
  })

  it("自动压缩与畸形 token 都只复述 SDK 确认的事实", async () => {
    const events = await run([
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: -1, post_tokens: "100" },
      },
      { type: "result", subtype: "success", is_error: false },
    ])
    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      item: { message: "上下文已自动压缩。" },
    })
  })
})
