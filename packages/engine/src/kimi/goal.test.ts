import { describe, expect, it } from "vitest"
import { kimiGoalUpdate } from "./goal.js"

const base = {
  goalId: "goal-1",
  objective: "完成发布审计",
  status: "active" as const,
  turnsUsed: 2,
  tokensUsed: 1234,
  wallClockMs: 8500,
  budget: { tokenBudget: 20_000 },
}

describe("Kimi 原生目标", () => {
  it("四种原生状态、可选预算与毫秒计时逐项翻译", () => {
    const cases = [
      ["active", "active"],
      ["paused", "paused"],
      ["blocked", "blocked"],
      ["complete", "complete"],
    ] as const
    for (const [raw, status] of cases) {
      expect(kimiGoalUpdate({ ...base, status: raw })).toEqual({
        goal: {
          objective: "完成发布审计", status, tokenBudget: 20_000,
          tokensUsed: 1234, timeUsedSeconds: 8.5,
        },
      })
    }
    expect(kimiGoalUpdate({ ...base, budget: { tokenBudget: null } })).toEqual({
      goal: { objective: "完成发布审计", status: "active", tokensUsed: 1234, timeUsedSeconds: 8.5 },
    })
  })

  it("明确 null 与畸形快照分得开", () => {
    expect(kimiGoalUpdate(null)).toEqual({ goal: undefined })
    const cases = [
      undefined,
      { ...base, objective: "" },
      { ...base, status: "future" },
      { ...base, tokensUsed: -1 },
      { ...base, wallClockMs: Number.NaN },
      { ...base, budget: { tokenBudget: "100" } },
      { ...base, budget: undefined },
    ]
    for (const value of cases) expect(kimiGoalUpdate(value)).toBeUndefined()
  })
})
