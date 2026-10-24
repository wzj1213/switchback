import { describe, expect, it } from "vitest"
import type { EngineGoal } from "@switchback/protocol"
import { goalDisplay } from "./GoalBar.js"

describe("Web 原生目标状态条", () => {
  it("保留终态、预算与完整悬停说明", () => {
    const goal: EngineGoal = {
      objective: "收完审计",
      status: "complete",
      tokenBudget: 25_000,
      tokensUsed: 25_000,
      timeUsedSeconds: 3_661,
    }
    expect(goalDisplay(goal, "zh-CN")).toEqual({
      label: "目标已完成",
      usage: "25k / 25k tokens",
      title: "目标已完成 · 收完审计 · 25k / 25k tokens · 已运行 1 小时 1 分钟",
    })
  })

  it("英文：没有预算时只报用了多少", () => {
    const goal: EngineGoal = { objective: "Finish the audit", status: "active", tokensUsed: 1_500, timeUsedSeconds: 125 }
    expect(goalDisplay(goal, "en")).toEqual({
      label: "Goal in progress",
      usage: "1.5k used",
      title: "Goal in progress · Finish the audit · 1.5k used · running for 2m",
    })
  })
})
