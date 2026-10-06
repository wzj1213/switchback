import type { EngineGoal, GoalStatus } from "@switchback/protocol"
import type { KimiGoalSnapshot } from "./wire.js"

const STATUS: Readonly<Record<string, GoalStatus>> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  complete: "complete",
}

export interface KimiGoalUpdate {
  /** `undefined` 在这个包装里表示 Kimi 明确给了 null，不是畸形帧。 */
  goal: EngineGoal | undefined
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function objectiveOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function budgetOf(value: unknown): Pick<EngineGoal, "tokenBudget"> | undefined {
  const budget = record(value)
  if (budget === undefined) return undefined
  const raw = budget["tokenBudget"]
  if (raw === null) return {}
  const tokenBudget = count(raw)
  return tokenBudget === undefined ? undefined : { tokenBudget }
}

function goalOf(raw: unknown): EngineGoal | undefined {
  const value = record(raw)
  const objective = objectiveOf(value?.["objective"])
  const status = STATUS[String(value?.["status"] ?? "")]
  const tokensUsed = count(value?.["tokensUsed"])
  const wallClockMs = count(value?.["wallClockMs"])
  const budget = budgetOf(value?.["budget"])
  if ([objective, status, tokensUsed, wallClockMs, budget].some((part) => part === undefined)) return undefined
  return {
    objective: objective as string,
    status: status as GoalStatus,
    ...(budget as Pick<EngineGoal, "tokenBudget">),
    tokensUsed: tokensUsed as number,
    timeUsedSeconds: (wallClockMs as number) / 1000,
  }
}

/** Kimi 完整目标快照 → 只读镜像；null 清空，畸形更新不覆盖上一份可信状态。 */
export function kimiGoalUpdate(raw: unknown): KimiGoalUpdate | undefined {
  if (raw === null) return { goal: undefined }
  const goal = goalOf(raw)
  return goal === undefined ? undefined : { goal }
}

/** 仅供线上类型收窄；运行时仍由 `kimiGoalUpdate` 逐字段校验。 */
export type KimiGoalWire = KimiGoalSnapshot | null
