import type { Event, Lane, ThreadId } from "@omni/protocol"
import type { KimiPayload, KimiSnapshot, KimiSubagent, KimiTask } from "./wire.js"

interface ActivityOut {
  threadId: ThreadId
  emit: (event: Event) => void
}

const TYPES = new Set([
  "subagent.spawned",
  "subagent.started",
  "subagent.suspended",
  "subagent.completed",
  "subagent.failed",
  "task.started",
  "task.terminated",
  "background.task.started",
  "background.task.terminated",
])

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

const terminal = (lane: Lane | undefined): boolean => lane?.status === "done" || lane?.status === "failed"

function nativeAt(value: unknown, fallback: number): number {
  if (typeof value !== "string" && typeof value !== "number") return fallback
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : fallback
}

function laneId(id: string): string {
  return `kimi-subagent-${id}`
}

function taskLaneId(id: string): string {
  return `kimi-task-${id}`
}

function statusOf(status: KimiSubagent["status"]): Lane["status"] {
  if (status === "completed") return "done"
  if (status === "failed" || status === "cancelled") return "failed"
  return "running"
}

function suspendedProgress(title: string, reason: string | undefined): Lane["progress"] | undefined {
  if (reason === undefined) return undefined
  return { nodes: [{ id: "state", label: title, state: "running", detail: reason }] }
}

function firstString(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const found = str(value)
    if (found !== undefined) return found
  }
  return undefined
}

function snapshotSummary(raw: KimiSubagent, status: Lane["status"]): string | undefined {
  if (status === "done") return str(raw.output_preview)
  if (status === "failed") return str(raw.error)
  return undefined
}

function decorate(lane: Lane, summary: string | undefined, progress: Lane["progress"] | undefined): Lane {
  let next = lane
  if (summary !== undefined) next = { ...next, summary }
  if (progress !== undefined) next = { ...next, progress }
  return next
}

function clearProgress(lane: Lane): Lane {
  const next = { ...lane }
  delete next.progress
  return next
}

function snapshotLane(raw: KimiSubagent, before: Lane | undefined, out: ActivityOut, at: number): Lane | undefined {
  if (raw.kind !== "subagent") return undefined
  const native = str(raw.id)
  const title = firstString([raw.description, raw.subagent_type, before?.title])
  if (native === undefined || title === undefined) return undefined
  const status = raw.subagent_phase === "suspended" ? "paused" : statusOf(raw.status)
  const reason = raw.subagent_phase === "suspended" ? str(raw.suspended_reason) : undefined
  const lane: Lane = {
    id: laneId(native),
    threadId: out.threadId,
    kind: "activity",
    title,
    status,
    at: before?.at ?? nativeAt(raw.created_at ?? raw.started_at, at),
    handle: native,
  }
  return decorate(lane, snapshotSummary(raw, status), suspendedProgress(title, reason))
}

function taskStatus(raw: unknown): Lane["status"] | undefined {
  if (raw === "running") return "running"
  if (raw === "completed") return "done"
  if (["failed", "cancelled", "timed_out", "killed", "lost"].includes(String(raw))) return "failed"
  return undefined
}

function isBackgroundTask(kind: unknown): boolean {
  return kind === "process" || kind === "bash"
}

function taskLane(raw: Record<string, unknown>, before: Lane | undefined, out: ActivityOut, at: number): Lane | undefined {
  if (!isBackgroundTask(raw["kind"])) return undefined
  const native = str(raw["taskId"] ?? raw["id"])
  const title = firstString([raw["description"], before?.title])
  const status = taskStatus(raw["status"])
  if (native === undefined || title === undefined || status === undefined) return undefined
  const started = raw["startedAt"] ?? raw["created_at"] ?? raw["started_at"]
  const summary = status === "failed" ? str(raw["stopReason"]) : undefined
  return decorate({
    id: taskLaneId(native), threadId: out.threadId, kind: "activity", title, status,
    at: before?.at ?? nativeAt(started, at), handle: native,
  }, summary, undefined)
}

function sameLane(left: Lane | undefined, right: Lane): boolean {
  if (left === undefined) return false
  return left.title === right.title && left.status === right.status && left.at === right.at &&
    left.summary === right.summary && left.handle === right.handle &&
    JSON.stringify(left.progress) === JSON.stringify(right.progress)
}

export class KimiActivityTracker {
  private readonly lanes = new Map<string, Lane>()

  constructor(private readonly out: ActivityOut) {}

  private emit(lane: Lane, at: number): void {
    const before = this.lanes.get(lane.id)
    if (terminal(before) && (lane.status === "running" || lane.status === "paused")) return
    const next = { ...lane, at: before?.at ?? lane.at }
    if (sameLane(before, next)) return
    this.lanes.set(next.id, next)
    this.out.emit({ type: "lane.updated", at, threadId: this.out.threadId, lane: next })
  }

  private running(payload: KimiPayload, at: number): void {
    const native = str(payload["subagentId"])
    if (native === undefined) return
    const id = laneId(native)
    const before = this.lanes.get(id)
    const title = str(payload["description"]) ?? str(payload["subagentName"]) ?? before?.title
    if (title === undefined) return
    const reason = payload.type === "subagent.suspended" ? str(payload["reason"]) : undefined
    const lane: Lane = {
      id,
      threadId: this.out.threadId,
      kind: "activity",
      title,
      status: payload.type === "subagent.suspended" ? "paused" : "running",
      at: before?.at ?? at,
      handle: native,
    }
    this.emit(decorate(lane, undefined, suspendedProgress(title, reason)), at)
  }

  private settled(payload: KimiPayload, at: number): void {
    const native = str(payload["subagentId"])
    if (native === undefined) return
    const id = laneId(native)
    const before = this.lanes.get(id)
    if (before === undefined) return
    const failed = payload.type === "subagent.failed"
    const summary = str(failed ? payload["error"] : payload["resultSummary"])
    const lane = clearProgress({ ...before, status: failed ? "failed" : "done" })
    this.emit(decorate(lane, summary, undefined), at)
  }

  private task(payload: KimiPayload, at: number): void {
    if (typeof payload["info"] !== "object" || payload["info"] === null) return
    const raw = payload["info"] as Record<string, unknown>
    const native = str(raw["taskId"])
    const before = native === undefined ? undefined : this.lanes.get(taskLaneId(native))
    const lane = taskLane(raw, before, this.out, at)
    if (lane !== undefined) this.emit(lane, at)
  }

  handle(payload: KimiPayload, at: number): boolean {
    if (payload.type === undefined || !TYPES.has(payload.type)) return false
    if (payload.type.startsWith("task.") || payload.type.startsWith("background.task.")) this.task(payload, at)
    else if (payload.type === "subagent.completed" || payload.type === "subagent.failed") this.settled(payload, at)
    else this.running(payload, at)
    return true
  }

  reconcile(snapshot: KimiSnapshot, at: number, tasks: readonly KimiTask[] = []): void {
    for (const raw of snapshot.subagents ?? []) {
      const id = str(raw.id)
      const before = id === undefined ? undefined : this.lanes.get(laneId(id))
      const lane = snapshotLane(raw, before, this.out, at)
      if (lane !== undefined) this.emit(lane, at)
    }
    for (const raw of tasks) {
      const before = this.lanes.get(taskLaneId(raw.id))
      const lane = taskLane(raw as unknown as Record<string, unknown>, before, this.out, at)
      if (lane !== undefined) this.emit(lane, at)
    }
  }
}
