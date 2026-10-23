import { describe, expect, it } from "vitest"
import type { EngineGoal } from "@switchback/protocol"
import { goalDisplay as displayIn } from "./GoalBar.js"

// 下面那些用例写的是中文那版
const goalDisplay = (goal: EngineGoal): ReturnType<typeof displayIn> => displayIn(goal, "zh-CN")

describe("桌面原生目标状态条", () => {
  it("逐项保留六种状态，并只在引擎给出预算时显示分母", () => {
    const base: EngineGoal = { objective: "收完审计", status: "active", tokensUsed: 1_200, timeUsedSeconds: 65 }
    const cases = [
      ["active", "目标进行中"],
      ["paused", "目标已暂停"],
      ["blocked", "目标受阻"],
      ["usage_limited", "用量受限"],
      ["budget_limited", "预算已用尽"],
      ["complete", "目标已完成"],
    ] as const
    for (const [status, label] of cases) expect(goalDisplay({ ...base, status }).label).toBe(label)
    expect(goalDisplay(base)).toMatchObject({ usage: "已用 1.2k", title: expect.stringContaining("已运行 1 分钟") })
    expect(goalDisplay({ ...base, tokenBudget: 20_000 }).usage).toBe("1.2k / 20k tokens")
  })
})

describe("英文那版", () => {
  it("状态、用量与时长", () => {
    const goal: EngineGoal = { objective: "audit", status: "paused", tokensUsed: 1_200, timeUsedSeconds: 3_660 }
    expect(displayIn(goal, "en")).toEqual({ label: "Goal paused", usage: "1.2k used", title: "Goal paused · audit · 1.2k used · running for 1h 1m" })
  })
})
