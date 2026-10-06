import type { EngineGoal, GoalStatus } from "@switchback/protocol"
import type { WireGoalUpdated } from "./wire.js"

const STATUS: Readonly<Record<string, GoalStatus>> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usageLimited: "usage_limited",
  budgetLimited: "budget_limited",
  complete: "complete",
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function objectiveOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() === "" ? undefined : value
}

function statusOf(value: unknown): GoalStatus | undefined {
  return typeof value === "string" ? STATUS[value] : undefined
}

function budgetPatch(value: unknown): Pick<EngineGoal, "tokenBudget"> | undefined {
  if (value === null || value === undefined) return {}
  const tokenBudget = count(value)
  return tokenBudget === undefined ? undefined : { tokenBudget }
}

/** Codex 的完整目标快照 → Switchback 只读镜像；畸形帧不覆盖上一份可信状态。 */
export function goalOf(params: WireGoalUpdated): EngineGoal | undefined {
  const raw = params.goal
  if (raw === undefined) return undefined
  const objective = objectiveOf(raw.objective)
  const status = statusOf(raw.status)
  const tokensUsed = count(raw.tokensUsed)
  const timeUsedSeconds = count(raw.timeUsedSeconds)
  if ([objective, status, tokensUsed, timeUsedSeconds].some((value) => value === undefined)) return undefined
  const budget = budgetPatch(raw.tokenBudget)
  if (budget === undefined) return undefined
  return {
    objective: objective as string,
    status: status as GoalStatus,
    ...budget,
    tokensUsed: tokensUsed as number,
    timeUsedSeconds: timeUsedSeconds as number,
  }
}
