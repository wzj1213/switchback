import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { handleNotification, type NotifyContext } from "./notify.js"

function setup(): { ctx: NotifyContext; events: Event[] } {
  const events: Event[] = []
  return {
    events,
    ctx: {
      threadId: "omni-thread",
      codexThread: () => "codex-thread",
      emit: (event) => events.push(event),
      turnId: () => "omni-turn",
      inflight: new Map(),
      streamed: new Map(),
      materialized: new Set(),
      safetyActive: new Set(),
      mcpSeen: new Map(),
      now: () => 100,
    },
  }
}

describe("Codex 原生安全状态", () => {
  it("网络安全资质验证只认协议枚举，并在重复通知时原地更新", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "model/verification", {
      threadId: "codex-thread", turnId: "native-turn", verifications: ["unknown"],
    })
    expect(events).toEqual([])
    const verified = {
      threadId: "codex-thread", turnId: "native-turn", verifications: ["trustedAccessForCyber"],
    }
    handleNotification(ctx, "model/verification", verified)
    handleNotification(ctx, "model/verification", verified)
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated"])
    expect(events[0]).toMatchObject({ item: { level: "warning", message: expect.stringContaining("chatgpt.com/cyber") } })
  })

  it("严格复核按原生开始时间区分，多次工具复核不会互相覆盖", () => {
    const { ctx, events } = setup()
    for (const startedAtMs of [10, 20]) {
      handleNotification(ctx, "autoApprovalReview/strictReviewRequired", {
        threadId: "codex-thread", turnId: "native-turn", startedAtMs,
      })
    }
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.started"])
    expect(events.map((event) => event.type === "item.started" ? event.item.id : ""))
      .toEqual(["codex-strict-review-omni-turn-10", "codex-strict-review-omni-turn-20"])
  })

  it("安全缓冲从等待更新到继续，并保留 Codex 给的更快模型建议", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "model/safetyBuffering/updated", {
      threadId: "codex-thread", turnId: "native-turn", showBufferingUi: false,
    })
    expect(events).toEqual([])
    handleNotification(ctx, "model/safetyBuffering/updated", {
      threadId: "codex-thread", turnId: "native-turn", showBufferingUi: true, fasterModel: "fast-model",
    })
    handleNotification(ctx, "model/safetyBuffering/updated", {
      threadId: "codex-thread", turnId: "native-turn", showBufferingUi: false,
    })
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated"])
    expect(events[0]).toMatchObject({ item: { message: expect.stringContaining("fast-model") } })
    expect(events[1]).toMatchObject({ item: { message: "Codex 已结束额外安全检查，正在继续响应。" } })
  })

  it("hide 通知缺席时由轮次终态收掉等待提示", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "model/safetyBuffering/updated", {
      threadId: "codex-thread", turnId: "native-turn", showBufferingUi: true,
    })
    handleNotification(ctx, "turn/completed", {
      threadId: "codex-thread", turn: { id: "native-turn", status: "failed" },
    })
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated", "turn.completed"])
    expect(events[1]).toMatchObject({ item: { level: "warning", message: expect.stringContaining("失败结束") } })
  })
})
