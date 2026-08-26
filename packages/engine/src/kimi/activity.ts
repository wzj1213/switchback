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

/**
 * 后台任务的结论。**全是引擎自己给的原文**，omni 一个字不补。
 *
 * 实测（Kimi 0.38.0，2026-08-25 真机）：**WebSocket 的 `task.terminated` 只带
 * 命令、退出码与起止时间，不带输出**；输出在它的 REST 那侧
 *（`GET /sessions/{id}/tasks` 的 `output_preview`、`/tasks/{id}?with_output=true`），
 * 而 omni 目前只在启动与重连时读回任务表。所以这里三个来源都收着：
 * 哪一头给了就用哪一头，都没给就缺席——**不去翻它 `~/.kimi-code` 下的日志文件**。
 * （`outputTail` 是它自己 wire 日志里的字段名，同一份数据换个门出来时还叫这个。）
 */
function taskSummary(raw: Record<string, unknown>, status: Lane["status"]): string | undefined {
  const output = firstString([raw["outputTail"], raw["output_preview"]])
  if (status !== "failed") return output
  return firstString([raw["stopReason"], raw["error"], output])
}

interface TaskFacts {
  native: string
  title: string
  status: Lane["status"]
}

function taskFacts(raw: Record<string, unknown>, before: Lane | undefined): TaskFacts | undefined {
  if (!isBackgroundTask(raw["kind"])) return undefined
  const native = str(raw["taskId"] ?? raw["id"])
  const title = firstString([raw["description"], before?.title])
  const status = taskStatus(raw["status"])
  if (native === undefined || title === undefined || status === undefined) return undefined
  return { native, title, status }
}

function taskLane(raw: Record<string, unknown>, before: Lane | undefined, out: ActivityOut, at: number): Lane | undefined {
  const facts = taskFacts(raw, before)
  if (facts === undefined) return undefined
  const started = raw["startedAt"] ?? raw["created_at"] ?? raw["started_at"]
  // 命令原文只在开始帧齐全，心跳与快照可能不带；带过一次就不能被后来的空帧抹掉
  const command = firstString([raw["command"], before?.command])
  return decorate({
    id: taskLaneId(facts.native), threadId: out.threadId, kind: "activity",
    title: facts.title, status: facts.status,
    at: before?.at ?? nativeAt(started, at), handle: facts.native,
    ...(command === undefined ? {} : { command }),
    // 同理：重连读回若不带输出，也不能把已经收到的那份结论抹掉
  }, taskSummary(raw, facts.status) ?? before?.summary, undefined)
}

function sameLane(left: Lane | undefined, right: Lane): boolean {
  if (left === undefined) return false
  return left.title === right.title && left.status === right.status && left.at === right.at &&
    left.summary === right.summary && left.handle === right.handle && left.command === right.command &&
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
    const info = payload["info"] as Record<string, unknown>
    const native = str(info["taskId"])
    const before = native === undefined ? undefined : this.lanes.get(taskLaneId(native))
    // 输出若真的随帧来，它是 `info` 的**兄弟字段**（实测它自己的 wire 日志里如此），
    // 不在 `info` 里面——摊平一层再判，省得两处各写一遍
    const lane = taskLane({ ...info, outputTail: payload["outputTail"] }, before, this.out, at)
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
