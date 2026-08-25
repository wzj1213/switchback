import { describe, expect, it } from "vitest"
import { goalOf } from "./goal.js"

describe("Codex 原生目标", () => {
  it("六种原生状态与可选预算逐项翻译", () => {
    const cases = [
      ["active", "active"],
      ["paused", "paused"],
      ["blocked", "blocked"],
      ["usageLimited", "usage_limited"],
      ["budgetLimited", "budget_limited"],
      ["complete", "complete"],
    ] as const
    for (const [raw, status] of cases) {
      expect(goalOf({
        goal: { objective: "修完审计", status: raw, tokenBudget: 20_000, tokensUsed: 1_234, timeUsedSeconds: 8 },
      })).toEqual({ objective: "修完审计", status, tokenBudget: 20_000, tokensUsed: 1_234, timeUsedSeconds: 8 })
    }
    expect(goalOf({
      goal: { objective: "无预算", status: "active", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0 },
    })).toEqual({ objective: "无预算", status: "active", tokensUsed: 0, timeUsedSeconds: 0 })
  })

  it("畸形快照不制造目标，也不拿未知状态冒充已有状态", () => {
    const cases = [
      {},
      { goal: { objective: "", status: "active", tokensUsed: 0, timeUsedSeconds: 0 } },
      { goal: { objective: "x", status: "future", tokensUsed: 0, timeUsedSeconds: 0 } },
      { goal: { objective: "x", status: "active", tokensUsed: -1, timeUsedSeconds: 0 } },
      { goal: { objective: "x", status: "active", tokenBudget: "100", tokensUsed: 0, timeUsedSeconds: 0 } },
    ]
    for (const value of cases) expect(goalOf(value)).toBeUndefined()
  })
})
