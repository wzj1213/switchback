import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop, type TurnRef } from "./loop.js"

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1",
    cwd: "/work",
    home: "/home/dev",
    trust: "auto-edit",
    memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

function turnRef(current: string | undefined): TurnRef {
  const ref = createTurnRef(() => undefined)
  ref.current = current
  return ref
}

describe("Claude 消息循环收尾", () => {
  it("把原生近似思考 token 原地更新，并在输出与收工时清空", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-thinking")
    await runMessageLoop(
      stream([
        { type: "system", subtype: "thinking_tokens", estimated_tokens: 41, estimated_tokens_delta: 41 },
        { type: "system", subtype: "thinking_tokens", estimated_tokens: 41, estimated_tokens_delta: 0 },
        { type: "system", subtype: "thinking_tokens", estimated_tokens: 80, estimated_tokens_delta: 39 },
        { type: "assistant", message: { content: [{ type: "text", text: "先看一下" }] } },
        { type: "system", subtype: "thinking_tokens", estimated_tokens: 12, estimated_tokens_delta: 12 },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.filter((event) => event.type === "thinking.updated")).toEqual([
      { type: "thinking.updated", at: expect.any(Number), threadId: "thread-1", turnId: "turn-thinking", estimatedTokens: 41 },
      { type: "thinking.updated", at: expect.any(Number), threadId: "thread-1", turnId: "turn-thinking", estimatedTokens: 80 },
      { type: "thinking.updated", at: expect.any(Number), threadId: "thread-1", turnId: "turn-thinking" },
      { type: "thinking.updated", at: expect.any(Number), threadId: "thread-1", turnId: "turn-thinking", estimatedTokens: 12 },
      { type: "thinking.updated", at: expect.any(Number), threadId: "thread-1", turnId: "turn-thinking" },
    ])
    expect(ref.thinking.estimatedTokens).toBeUndefined()
  })

  it("把 hook 阻断的原生提示保留在发起它的轮次里", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-hook")
    await runMessageLoop(
      stream([
        {
          type: "system",
          subtype: "informational",
          content: "Operation stopped by hook",
          level: "warning",
          prevent_continuation: true,
        },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      item: {
        id: "turn-hook:i1",
        turnId: "turn-hook",
        kind: "notice",
        message: "Operation stopped by hook",
        level: "warning",
      },
    })
  })

  it("同一工具的 informational 进度就地更新，不在 transcript 里堆重复行", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-progress")
    await runMessageLoop(
      stream([
        { type: "system", subtype: "informational", content: "准备中", level: "info", tool_use_id: "tool-1" },
        { type: "system", subtype: "informational", content: "快好了", level: "notice", tool_use_id: "tool-1" },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.filter((event) => event.type === "item.started")).toHaveLength(1)
    expect(events.find((event) => event.type === "item.updated")).toMatchObject({
      item: { id: "turn-progress:i1", message: "快好了", level: "notice" },
    })
    expect(ref.notices.size).toBe(0)
  })

  it("把结构化订阅告警送进统一限额状态", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-limit")
    await runMessageLoop(
      stream([
        {
          type: "rate_limit_event",
          rate_limit_info: { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.91 },
        },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.find((event) => event.type === "limits.updated")).toMatchObject({
      engine: "claude",
      limits: { secondary: { usedPercent: 91, windowDurationMins: 300 } },
    })
  })

  it("中途把 Claude 发现的新技能命令整份换给宿主", async () => {
    const events: Event[] = []
    const ref = turnRef(undefined)
    await runMessageLoop(
      stream([
        { type: "system", subtype: "init", terminal_slash_commands: ["doctor"] },
        {
          type: "system",
          subtype: "commands_changed",
          commands: [
            { name: "doctor", description: "Terminal diagnostics", argumentHint: "" },
            { name: "project-review", description: "Review this project", argumentHint: "<path>" },
          ],
        },
        { type: "system", subtype: "commands_changed", commands: [] },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.filter((event) => event.type === "commands.updated")).toEqual([
      {
        type: "commands.updated",
        at: expect.any(Number),
        threadId: "thread-1",
        engine: "claude",
        commands: [
          {
            name: "project-review",
            description: "Review this project",
            argumentHint: "<path>",
            source: "engine",
          },
        ],
      },
      {
        type: "commands.updated",
        at: expect.any(Number),
        threadId: "thread-1",
        engine: "claude",
        commands: [],
      },
    ])
  })

  it("同一轮 API 重试原地更新一条可恢复错误", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-retry")
    await runMessageLoop(
      stream([
        {
          type: "system", subtype: "api_retry", attempt: 1, max_retries: 5,
          retry_delay_ms: 500, error_status: 529, error: "overloaded",
        },
        {
          type: "system", subtype: "api_retry", attempt: 2, max_retries: 5,
          retry_delay_ms: 1000, error_status: null, error: "server_error",
        },
        { type: "result", subtype: "success", is_error: false },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    const retryEvents = events.filter((event) => event.type === "item.started" || event.type === "item.updated")
    expect(retryEvents.map((event) => event.type)).toEqual(["item.started", "item.updated"])
    expect(retryEvents[1]).toMatchObject({
      item: {
        id: "turn-retry:claude-api-retry",
        message: "Claude API 正在重试（2/5，1000ms 后）",
        detail: "server_error",
        fatal: false,
      },
    })
    expect(ref.retry).toBeUndefined()
  })

  it("失败 result 把 Claude 原文交给宿主解释层", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-error")
    await runMessageLoop(
      stream([
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "There's an issue with the selected model.",
        },
      ]),
      request(events),
      ref,
      () => "auto-edit",
    )

    expect(events.find((event) => event.type === "turn.completed")).toMatchObject({
      status: "failed",
      error: "There's an issue with the selected model.",
    })
  })

  it("/clear 留下上下文分界，并从下一条 result 记真正的新 session handle", async () => {
    const events: Event[] = []
    const handles: string[] = []
    const req = request(events)
    req.onHandle = (handle) => handles.push(handle)
    await runMessageLoop(
      stream([
        {
          type: "conversation_reset",
          new_conversation_id: "conversation-2",
          session_id: "old-session",
        },
        { type: "result", subtype: "success", is_error: false, result: "", session_id: "new-session" },
      ]),
      req,
      turnRef("turn-clear"),
      () => "auto-edit",
    )

    expect(handles).toEqual(["new-session"])
    expect(events.find((event) => event.type === "usage.cleared")).toMatchObject({ engine: "claude" })
    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      item: {
        id: "turn-clear:i1",
        kind: "notice",
        message: expect.stringContaining("后续回答不会再读取"),
      },
    })
    expect(events.find((event) => event.type === "turn.completed")).toMatchObject({ status: "completed" })
  })

  it("result 成功但漏了 tool_result 时，不留下永远 running 的工具", async () => {
    const events: Event[] = []
    const ref = turnRef("turn-1")
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
