import type { LaneNode } from "@omni/protocol"
import type { ForeignActivity } from "./caps.js"

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

function goalStatus(value: string): ForeignActivity["status"] {
  if (value === "active") return "running"
  if (value === "complete" || value === "cleared") return "done"
  if (value === "failed" || value === "interrupted") return "failed"
  return "paused"
}

function nodeState(status: ForeignActivity["status"]): LaneNode["state"] {
  if (status === "running") return "running"
  if (status === "done") return "done"
  if (status === "failed") return "failed"
  return "pending"
}

function phaseLabel(update: Record<string, unknown>): string | undefined {
  if (update["verifying_completion"] === true) return "Verifying"
  if (update["planning"] === true) return "Planning"
  const phase = text(update["phase"])
  if (phase === "executing") return "Executing"
  if (phase === "planning") return "Planning"
  if (phase === "idle") return "Idle"
  return phase
}

function metricDetail(update: Record<string, unknown>): string | undefined {
  const parts: string[] = []
  const context = update["live_context_pct"]
  const turns = update["live_turn_count"]
  const tools = update["live_tool_call_count"]
  if (typeof context === "number") parts.push(`Context ${String(context)}%`)
  if (typeof turns === "number") parts.push(`${String(turns)} turns`)
  if (typeof tools === "number") parts.push(`${String(tools)} tools`)
  return parts.length === 0 ? undefined : parts.join(" · ")
}

function modelNodes(raw: unknown, state: LaneNode["state"]): LaneNode[] {
  if (!Array.isArray(raw)) return []
  const nodes: LaneNode[] = []
  for (const [index, value] of raw.entries()) {
    if (!Array.isArray(value)) continue
    const model = text(value[0])
    const tokens = value[1]
    if (model === undefined || typeof tokens !== "number" || tokens <= 0) continue
    nodes.push({ id: `model-${String(index)}`, label: model, parent: "subagent", state, tokens })
  }
  return nodes
}

function goalNodes(update: Record<string, unknown>, status: ForeignActivity["status"]): LaneNode[] {
  const state = nodeState(status)
  const phase = phaseLabel(update)
  const nodes: LaneNode[] = []
  if (phase !== undefined) {
    const detail = text(update["last_event_detail"]) ?? text(update["last_event"])
    nodes.push({ id: "phase", label: phase, state, ...(detail === undefined ? {} : { detail }) })
  }
  const role = text(update["current_subagent_role"])
  if (role === undefined) return nodes
  const liveTokens = update["live_subagent_tokens"]
  const detail = metricDetail(update)
  nodes.push({
    id: "subagent", label: role, state,
    ...(phase === undefined ? {} : { parent: "phase" }),
    ...(detail === undefined ? {} : { detail }),
    ...(typeof liveTokens === "number" && liveTokens > 0 ? { tokens: liveTokens } : {}),
  })
  nodes.push(...modelNodes(update["live_tokens_by_model"], state))
  return nodes
}

function goalProgress(
  update: Record<string, unknown>,
  status: ForeignActivity["status"],
): ForeignActivity["progress"] | undefined {
  const nodes = goalNodes(update, status)
  const used = update["tokens_used"]
  const total = update["token_budget"]
  const budget = typeof used === "number" && used >= 0
    ? { used, ...(typeof total === "number" && total > 0 ? { total } : {}) }
    : undefined
  if (nodes.length === 0 && budget === undefined) return undefined
  return { nodes, ...(budget === undefined ? {} : { budget }) }
}

function decorateGoal(
  activity: ForeignActivity,
  summary: string | undefined,
  progress: ForeignActivity["progress"] | undefined,
): ForeignActivity {
  if (summary !== undefined) activity.summary = summary
  if (progress !== undefined) activity.progress = progress
  return activity
}

/** GoalUpdated 的全量展示快照；不推进、不验证、不接管 Grok 的 goal orchestrator。 */
export function grokGoal(
  update: Record<string, unknown>,
  goalId: string,
  before: ForeignActivity | undefined,
): ForeignActivity | undefined {
  const rawStatus = text(update["status"])
  const title = text(update["objective"]) ?? before?.title
  if (rawStatus === undefined || title === undefined) return undefined
  if (rawStatus === "cleared" && before === undefined) return undefined
  const status = goalStatus(rawStatus)
  const summary = text(update["pause_message"]) ?? before?.summary
  const progress = rawStatus === "cleared" ? before?.progress : goalProgress(update, status)
  return decorateGoal({ id: `grok-goal-${goalId}`, title, status, handle: goalId }, summary, progress)
}
