import { describe, expect, it, vi } from "vitest"
import type { EngineGoal } from "@omni/protocol"
import { handleNotification, type NotifyContext } from "./notify.js"

function context(onGoal: (goal: EngineGoal | undefined) => void): NotifyContext {
  return {
    threadId: "th-omni",
    codexThread: () => "th-codex",
    turnId: () => undefined,
    codexTurn: () => undefined,
    settledTurns: new Set(["turn-settled"]),
    emit: () => undefined,
    inflight: new Map(),
    streamed: new Map(),
    materialized: new Set(),
    mcpSeen: new Map(),
    onGoal,
    now: () => 1,
  }
}

const update = {
  threadId: "th-codex",
  turnId: "turn-settled",
  goal: {
    threadId: "th-codex",
    objective: "把审计收完",
    status: "active",
    tokenBudget: 10_000,
    tokensUsed: 120,
    timeUsedSeconds: 4,
    createdAt: 1,
    updatedAt: 2,
  },
}

describe("Codex 目标通知路由", () => {
  it("目标是 thread 状态；即使关联轮次已结算也接收完整快照", () => {
    const onGoal = vi.fn<(goal: EngineGoal | undefined) => void>()
    handleNotification(context(onGoal), "thread/goal/updated", update)
    expect(onGoal).toHaveBeenCalledWith({
      objective: "把审计收完",
      status: "active",
      tokenBudget: 10_000,
      tokensUsed: 120,
      timeUsedSeconds: 4,
    })
  })

  it("清空与畸形更新分得开，别的 thread 一律不接", () => {
    const onGoal = vi.fn<(goal: EngineGoal | undefined) => void>()
    const ctx = context(onGoal)
    handleNotification(ctx, "thread/goal/updated", { ...update, goal: { ...update.goal, status: "future" } })
    handleNotification(ctx, "thread/goal/cleared", { threadId: "other" })
    expect(onGoal).not.toHaveBeenCalled()
    handleNotification(ctx, "thread/goal/cleared", { threadId: "th-codex" })
    expect(onGoal).toHaveBeenCalledWith(undefined)
  })
})
