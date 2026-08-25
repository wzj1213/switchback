import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"
import { emitNotification } from "./notification.js"

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude 原生通知", () => {
  it("保留通知键、优先级、颜色与超时，不改写成正文或故障", () => {
    const events: Event[] = []
    emitNotification({
      key: "fast-mode-overage-rejected", text: "Fast mode is unavailable",
      priority: "immediate", color: "error", timeout_ms: 2500,
    }, { threadId: "thread-1", at: 42, emit: (event) => events.push(event) })
    expect(events).toEqual([{
      type: "engine.notification", at: 42, threadId: "thread-1", engine: "claude",
      key: "fast-mode-overage-rejected", message: "Fast mode is unavailable",
      priority: "immediate", color: "error", timeoutMs: 2500,
    }])
  })

  it.each([
    [{ key: "", text: "x", priority: "low" }],
    [{ key: "k", text: "", priority: "low" }],
    [{ key: "k", text: "x", priority: "urgent" }],
  ])("坏载荷静默略过：%o", (message) => {
    const events: Event[] = []
    emitNotification(message, { threadId: "thread-1", at: 1, emit: (event) => events.push(event) })
    expect(events).toEqual([])
  })

  it("非法可选字段不污染事件", () => {
    const events: Event[] = []
    emitNotification({ key: "k", text: "x", priority: "medium", color: 1, timeout_ms: -1 }, {
      threadId: "thread-1", at: 1, emit: (event) => events.push(event),
    })
    expect(events[0]).not.toHaveProperty("color")
    expect(events[0]).not.toHaveProperty("timeoutMs")
  })

  it("消息循环在轮次外也转发通知，不依赖 transcript item", async () => {
    const events: Event[] = []
    await runMessageLoop(stream([{
      type: "system", subtype: "notification", key: "startup", text: "Account notice", priority: "low",
    }]), request(events), createTurnRef(() => undefined), () => "auto-edit")
    expect(events[0]).toMatchObject({
      type: "engine.notification", threadId: "thread-1", key: "startup", message: "Account notice",
    })
  })
})
