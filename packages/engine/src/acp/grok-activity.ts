import type { LaneNode } from "@omni/protocol"
import type {
  ForeignActivity,
  ForeignActivityOutput,
  ForeignActivityParser,
  ForeignActivityUpdate,
} from "./caps.js"
import { grokExtPayload } from "./grok-ext.js"
import { grokGoal } from "./grok-goal.js"

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

function firstText(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const found = text(value)
    if (found !== undefined) return found
  }
  return undefined
}

const terminal = (lane: ForeignActivity | undefined): boolean =>
  lane?.status === "done" || lane?.status === "failed"

function outcome(code: unknown, signal: string | undefined): Pick<ForeignActivity, "status" | "summary"> {
  if (signal !== undefined) return { status: "failed", summary: signal }
  if (code === 0 || code === null) return { status: "done" }
  if (typeof code === "number") return { status: "failed", summary: `exit code ${String(code)}` }
  return { status: "failed" }
}

function subagentStatus(value: unknown): ForeignActivity["status"] | undefined {
  if (value === "completed") return "done"
  if (value === "failed" || value === "cancelled") return "failed"
  return undefined
}

function workflowStatus(value: unknown): ForeignActivity["status"] | undefined {
  if (value === "active") return "running"
  if (["user_paused", "back_off_paused", "no_progress_paused", "infra_paused", "blocked", "budget_limited"].includes(String(value))) return "paused"
  if (value === "complete" || value === "cleared") return "done"
  if (value === "failed" || value === "interrupted" || value === "cancelled") return "failed"
  return typeof value === "string" ? "paused" : undefined
}

function nodeState(value: unknown): LaneNode["state"] {
  if (value === "active" || value === "running") return "running"
  if (value === "done" || value === "completed") return "done"
  if (value === "failed") return "failed"
  if (value === "cancelled" || value === "skipped") return "skipped"
  return "pending"
}

function phaseNodes(raw: unknown): { nodes: LaneNode[]; ids: ReadonlyMap<string, string> } {
  const nodes: LaneNode[] = []
  const ids = new Map<string, string>()
  if (!Array.isArray(raw)) return { nodes, ids }
  for (const [index, value] of raw.entries()) {
    const phase = record(value)
    const title = text(phase?.["title"])
    if (title === undefined) continue
    const id = `phase-${String(index)}`
    ids.set(title, id)
    nodes.push({ id, label: title, state: nodeState(phase?.["state"]) })
  }
  return { nodes, ids }
}

function agentIdentity(value: unknown): { raw: Record<string, unknown>; id: string; label: string } | undefined {
  const agent = record(value)
  if (agent === undefined) return undefined
  const id = text(agent["agent_id"])
  const label = text(agent["label"])
  if (id === undefined || label === undefined) return undefined
  return { raw: agent, id, label }
}

function agentNode(value: unknown, phases: ReadonlyMap<string, string>): LaneNode | undefined {
  const agent = agentIdentity(value)
  if (agent === undefined) return undefined
  const node: LaneNode = { id: `agent-${agent.id}`, label: agent.label, state: nodeState(agent.raw["state"]) }
  const phase = text(agent.raw["phase"])
  const parent = phase === undefined ? undefined : phases.get(phase)
  const detail = text(agent.raw["model"])
  const tokens = agent.raw["tokens_used"]
  if (parent !== undefined) node.parent = parent
  if (detail !== undefined) node.detail = detail
  if (typeof tokens === "number" && tokens > 0) node.tokens = tokens
  return node
}

function agentNodes(raw: unknown, phases: ReadonlyMap<string, string>): LaneNode[] {
  if (!Array.isArray(raw)) return []
  return raw.map((value) => agentNode(value, phases)).filter((node): node is LaneNode => node !== undefined)
}

function workflowProgress(update: Record<string, unknown>): ForeignActivity["progress"] | undefined {
  const phases = phaseNodes(update["phases"])
  const nodes = [...phases.nodes, ...agentNodes(update["agents"], phases.ids)]
  const used = update["agents_used"]
  const total = update["agent_budget"]
  const trustworthy = update["agent_usage_incomplete"] !== true && typeof used === "number" && used >= 0
  const budget = trustworthy
    ? { used, ...(typeof total === "number" && total > 0 ? { total } : {}) }
    : undefined
  if (nodes.length === 0 && budget === undefined) return undefined
  return { nodes, ...(budget === undefined ? {} : { budget }) }
}

function workflowRevision(value: unknown): number {
  return typeof value === "number" && value >= 0 ? value : 0
}

function workflowLane(
  update: Record<string, unknown>,
  runId: string,
  rawStatus: string,
  before: ForeignActivity | undefined,
): ForeignActivity | undefined {
  const title = firstText([update["objective"], update["name"], before?.title])
  const status = workflowStatus(rawStatus)
  if (title === undefined || status === undefined) return undefined
  const lane: ForeignActivity = { id: `grok-workflow-${runId}`, title, status, handle: runId }
  const summary = firstText([update["result_summary"], update["pause_message"], before?.summary])
  const progress = rawStatus === "cleared" ? before?.progress : workflowProgress(update)
  if (summary !== undefined) lane.summary = summary
  if (progress !== undefined) lane.progress = progress
  return lane
}

/** Grok 私有活动帧 → 每条原生会话独享的完整快照。 */
class GrokActivityTracker {
  private readonly lanes = new Map<string, ForeignActivity>()
  private readonly taskTools = new Map<string, string>()
  private readonly workflowChildren = new Set<string>()
  private readonly workflowRevisions = new Map<string, number>()
  private readonly clearedWorkflows = new Set<string>()

  handle(method: string, params: unknown): ForeignActivityUpdate | undefined {
    const direct = method.startsWith("_") ? method.slice(1) : method
    const update = record(grokExtPayload(method, params, direct)?.["update"])
    if (update === undefined) return undefined
    if (direct === "x.ai/task_backgrounded") return this.taskStarted(update)
    if (direct === "x.ai/task_completed") return this.taskFinished(update)
    if (direct === "x.ai/monitor_event") return this.monitorOutput(update)
    if (direct !== "x.ai/session_notification") return undefined
    return this.sessionUpdate(update)
  }

  private sessionUpdate(update: Record<string, unknown>): ForeignActivity | undefined {
    if (update["sessionUpdate"] === "subagent_spawned") return this.subagentSpawned(update)
    if (update["sessionUpdate"] === "subagent_progress") return this.subagentProgress(update)
    if (update["sessionUpdate"] === "subagent_finished") return this.subagentFinished(update)
    if (update["sessionUpdate"] === "workflow_updated") return this.workflow(update)
    if (update["sessionUpdate"] === "goal_updated") return this.goal(update)
    return undefined
  }

  private remember(next: ForeignActivity, resumable = false): ForeignActivity | undefined {
    const before = this.lanes.get(next.id)
    if (terminal(before) && (next.status === "running" || next.status === "paused")) {
      if (!resumable || before?.status === "done") return undefined
    }
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(next)) return undefined
    this.lanes.set(next.id, next)
    return next
  }

  private taskStarted(update: Record<string, unknown>): ForeignActivity | undefined {
    if (update["sessionUpdate"] !== "task_backgrounded") return undefined
    const taskId = text(update["task_id"])
    const title = firstText([update["monitor_description"], update["description"], update["command"]])
    if (taskId === undefined || title === undefined) return undefined
    const toolCallId = text(update["tool_call_id"])
    if (toolCallId !== undefined) this.taskTools.set(taskId, toolCallId)
    return this.remember({ id: `grok-task-${taskId}`, title, status: "running", handle: taskId })
  }

  private monitorOutput(update: Record<string, unknown>): ForeignActivityOutput | undefined {
    if (update["sessionUpdate"] !== "monitor_event") return undefined
    const taskId = text(update["task_id"])
    const event = text(update["event_text"])
    if (taskId === undefined || event === undefined) return undefined
    const itemId = this.taskTools.get(taskId)
    if (itemId === undefined) return undefined
    return { itemId, append: event.endsWith("\n") ? event : `${event}\n` }
  }

  private taskFinished(update: Record<string, unknown>): ForeignActivity | undefined {
    if (update["sessionUpdate"] !== "task_completed") return undefined
    const task = record(update["task_snapshot"])
    const taskId = text(task?.["task_id"])
    if (task === undefined || taskId === undefined || task["signal"] === "session_restart") return undefined
    const before = this.lanes.get(`grok-task-${taskId}`)
    const title = firstText([task["description"], task["display_command"], task["command"], before?.title])
    if (title === undefined) return undefined
    return this.remember({
      id: `grok-task-${taskId}`, title, handle: taskId, ...outcome(task["exit_code"], text(task["signal"])),
    })
  }

  private subagentSpawned(update: Record<string, unknown>): ForeignActivity | undefined {
    const child = text(update["child_session_id"])
    if (child === undefined) return undefined
    if (text(update["workflow_run_id"]) !== undefined) {
      this.workflowChildren.add(child)
      return undefined
    }
    const title = text(update["description"])
    if (title === undefined) return undefined
    return this.remember({ id: `grok-subagent-${child}`, title, status: "running", handle: child })
  }

  private subagentProgress(update: Record<string, unknown>): ForeignActivity | undefined {
    const child = text(update["child_session_id"])
    if (child === undefined || this.workflowChildren.has(child)) return undefined
    const before = this.lanes.get(`grok-subagent-${child}`)
    if (before === undefined) return undefined
    const used = update["tokens_used"]
    const total = update["context_window_tokens"]
    const budget = typeof used === "number" && used >= 0
      ? { used, ...(typeof total === "number" && total > 0 ? { total } : {}) }
      : undefined
    return this.remember({
      id: before.id, title: before.title, status: "running", handle: child,
      ...(budget === undefined ? {} : { progress: { nodes: [], budget } }),
    })
  }

  private subagentFinished(update: Record<string, unknown>): ForeignActivity | undefined {
    const child = text(update["child_session_id"])
    if (child === undefined || this.workflowChildren.has(child)) return undefined
    const before = this.lanes.get(`grok-subagent-${child}`)
    const status = subagentStatus(update["status"])
    if (before === undefined || status === undefined) return undefined
    const summary = status === "done" ? text(update["output"]) : text(update["error"])
    return this.remember({
      id: before.id, title: before.title, status, handle: child,
      ...(summary === undefined ? {} : { summary }),
    })
  }

  private staleWorkflow(id: string, revision: number, status: string): boolean {
    if (status === "cleared") return false
    const last = this.workflowRevisions.get(id)
    if (last !== undefined && revision === 0 && last > 0) return true
    if (last !== undefined && revision > 0 && revision <= last) return true
    return revision === 0 && this.clearedWorkflows.has(id)
  }

  private workflow(update: Record<string, unknown>): ForeignActivity | undefined {
    const runId = text(update["run_id"])
    const rawStatus = text(update["status"])
    if (runId === undefined || rawStatus === undefined) return undefined
    const revision = workflowRevision(update["revision"])
    if (this.staleWorkflow(runId, revision, rawStatus)) return undefined
    const next = workflowLane(update, runId, rawStatus, this.lanes.get(`grok-workflow-${runId}`))
    if (next === undefined) return undefined
    if (revision > 0) this.workflowRevisions.set(runId, revision)
    if (rawStatus === "cleared") this.clearedWorkflows.add(runId)
    return this.remember(next, true)
  }

  private goal(update: Record<string, unknown>): ForeignActivity | undefined {
    const goalId = text(update["goal_id"])
    if (goalId === undefined) return undefined
    const next = grokGoal(update, goalId, this.lanes.get(`grok-goal-${goalId}`))
    return next === undefined ? undefined : this.remember(next, true)
  }
}

/** 不启动、不编排任何 agent；只镜像 Grok 主动发到父会话的原生活动帧。 */
export function createGrokActivity(): ForeignActivityParser {
  const tracker = new GrokActivityTracker()
  return (method, params) => tracker.handle(method, params)
}
