import { afterEach, describe, expect, it, vi } from "vitest"
import type { Event, TurnId } from "@omni/protocol"
import { createHookTracker } from "./hooks.js"
import type { WireHookLifecycle, WireHookRun } from "./wire.js"

const run = (patch: Partial<WireHookRun> = {}): WireHookRun => ({
  id: "hook-1",
  eventName: "userPromptSubmit",
  handlerType: "command",
  executionMode: "sync",
  scope: "turn",
  source: "project",
  sourcePath: "/repo/.codex/hooks.json",
  status: "running",
  statusMessage: "checking input policy",
  entries: [],
  ...patch,
})

const hook = (patch: Partial<WireHookRun> = {}, turnId: string | null = "native-1"): WireHookLifecycle => ({
  threadId: "codex-thread",
  turnId,
  run: run(patch),
})

function setup(turn: TurnId | null = "turn-1") {
  const events: Event[] = []
  const tracker = createHookTracker({
    threadId: "thread-1",
    turnId: () => turn ?? undefined,
    emit: (event) => events.push(event),
    now: () => 100,
  })
  return { tracker, events }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("Codex hook 生命周期", () => {
  it("300ms 内无输出成功保持安静", () => {
    vi.useFakeTimers()
    const { tracker, events } = setup()
    tracker.started(hook())
    tracker.completed(hook({ status: "completed" }))
    vi.advanceTimersByTime(300)
    expect(events).toEqual([])
  })

  it("慢 hook 先显示运行态，完成后保留原生输出", () => {
    vi.useFakeTimers()
    const { tracker, events } = setup()
    tracker.started(hook())
    vi.advanceTimersByTime(299)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    tracker.completed(hook({
      status: "completed",
      entries: [{ kind: "warning", text: "policy changed" }],
    }))
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: "item.started",
      item: { id: "codex-hook-hook-1", status: "running", tool: "hook/userPromptSubmit" },
    })
    expect(events[1]).toMatchObject({
      type: "item.updated",
      item: { status: "ok", detail: { output: "warning: policy changed" } },
    })
  })

  it("即时拦截也直接落终态，不依赖 started 先到", () => {
    const { tracker, events } = setup()
    tracker.completed(hook({
      status: "blocked",
      entries: [{ kind: "feedback", text: "must start in plan mode" }],
    }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "item.started",
      item: { status: "denied", error: "feedback: must start in plan mode" },
    })
  })

  it("轮次失败会收掉已显示的同步 hook，迟到定时器不复活", () => {
    vi.useFakeTimers()
    const { tracker, events } = setup()
    tracker.started(hook())
    vi.advanceTimersByTime(300)
    tracker.settle("turn-1", "failed")
    vi.runAllTimers()
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: "item.updated", item: { status: "failed" } })
  })

  it("异步 hook 跨过轮次终态后仍按原轮次收真实结果", () => {
    vi.useFakeTimers()
    const { tracker, events } = setup()
    tracker.started(hook({ executionMode: "async" }, "native-old"))
    vi.advanceTimersByTime(300)
    tracker.settle("turn-1", "completed")
    tracker.completed(hook({
      executionMode: "async",
      status: "completed",
      entries: [{ kind: "context", text: "later context" }],
    }, "native-old"))
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      type: "item.updated",
      item: { turnId: "turn-1", status: "ok", detail: { output: "context: later context" } },
    })
  })

  it("相同 handler 跨两轮并发时按原生轮次分别配对", () => {
    vi.useFakeTimers()
    let turn: TurnId | undefined = "turn-a"
    const events: Event[] = []
    const tracker = createHookTracker({
      threadId: "thread-1", turnId: () => turn, emit: (event) => events.push(event), now: () => 100,
    })
    tracker.started(hook({ executionMode: "async" }, "native-a"))
    vi.advanceTimersByTime(300)
    tracker.settle("turn-a", "completed")
    turn = "turn-b"
    tracker.started(hook({ executionMode: "async" }, "native-b"))
    vi.advanceTimersByTime(300)
    tracker.completed(hook({
      executionMode: "async", status: "completed", entries: [{ kind: "context", text: "A" }],
    }, "native-a"))
    tracker.completed(hook({
      executionMode: "async", status: "completed", entries: [{ kind: "context", text: "B" }],
    }, "native-b"))
    expect(events.map((event) => event.type)).toEqual([
      "item.started", "item.started", "item.updated", "item.updated",
    ])
    expect(events.slice(2).map((event) =>
      event.type === "item.updated" && event.item.kind === "tool_call"
        ? [event.item.turnId, event.item.detail]
        : [])).toMatchObject([
      ["turn-a", { output: "context: A" }],
      ["turn-b", { output: "context: B" }],
    ])
  })

  it("没有轮次归属的异常仍进会话警告", () => {
    const { tracker, events } = setup(null)
    tracker.completed(hook({ status: "failed", entries: [{ kind: "error", text: "bad hook" }] }, null))
    expect(events).toEqual([expect.objectContaining({
      type: "engine.status",
      status: "degraded",
      detail: "checking input policy\nerror: bad hook",
    })])
  })

  it("关闭跟踪器会取消未显示的运行态", () => {
    vi.useFakeTimers()
    const { tracker, events } = setup()
    tracker.started(hook())
    tracker.close()
    vi.runAllTimers()
    expect(events).toEqual([])
  })
})
