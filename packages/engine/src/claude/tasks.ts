import type { Event, Lane, TaskRun, ThreadId } from "@switchback/protocol"
import { toLane } from "./workflow.js"
import { createTaskLinks, rememberTaskParent, type TaskLinks } from "./task-links.js"

/**
 * Claude 后台任务的四条公开消息按 `task_id` 汇成一条生命周期：started 给稳定标题，
 * progress 给当前活动，updated 给状态补丁，notification 给权威终态、总结与 usage。
 * 0.3.231 的公开 `SDKMessage` 已声明四条；2026-08-19 的 Task 与 workflow 活体也都抓到。
 *
 * workflow 的每-agent 树在 `task_progress.workflow_progress`。这个字段仍未进公开类型，
 * 但活体状态帧会带完整快照；两帧之间的 10 秒心跳不带它，所以缺席时必须保住上一棵树。
 * 一整个 workflow 共用一个 id，progress 的 description 是当前 agent；started 的 description
 * 才是整批稳定标题。原始帧与节点形状见 `workflow.ts`、对应测试和工程时间线。
 */

/** 活状态与持久 lane 的最近快照寿命不同，必须分开存。 */
export interface TaskState {
  active: Map<string, TaskRun>
  lanes: Map<string, Lane>
  hidden: Set<string>
  links: TaskLinks
}

export function createTaskState(): TaskState {
  return { active: new Map(), lanes: new Map(), hidden: new Set(), links: createTaskLinks() }
}

interface RawTaskProgress {
  task_id?: unknown
  description?: unknown
  subagent_type?: unknown
  last_tool_name?: unknown
  usage?: { tool_uses?: unknown; duration_ms?: unknown }
}

interface RawTaskStarted {
  task_id?: unknown
  description?: unknown
  skip_transcript?: unknown
}

interface RawTaskUpdated {
  task_id?: unknown
  patch?: { status?: unknown; description?: unknown; error?: unknown }
}

interface RawTaskNotification {
  task_id?: unknown
  status?: unknown
  summary?: unknown
  skip_transcript?: unknown
  usage?: { total_tokens?: unknown }
}

interface TaskOut {
  threadId: ThreadId
  emit: (event: Event) => void
}

interface TaskFrame {
  at: number
  out: TaskOut
}

interface LanePatch {
  id: string
  title: string
  status: Lane["status"]
}

interface TaskPatch {
  id: string
  description?: string
  status?: Lane["status"]
  error?: string
}

interface TaskFinal {
  id: string
  status: "done" | "failed"
  summary?: string
  skipTranscript: boolean
  used: unknown
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const terminal = (lane: Lane | undefined): boolean => lane?.status === "done" || lane?.status === "failed"

const STATUS: Readonly<Record<string, Lane["status"]>> = {
  pending: "running",
  running: "running",
  paused: "paused",
  completed: "done",
  failed: "failed",
  killed: "failed",
  stopped: "failed",
}

function emitTasks(state: TaskState, frame: TaskFrame): void {
  frame.out.emit({
    type: "tasks.updated", at: frame.at, threadId: frame.out.threadId, tasks: [...state.active.values()],
  })
}

function emitLane(state: TaskState, lane: Lane, frame: TaskFrame): void {
  state.lanes.set(lane.id, lane)
  frame.out.emit({ type: "lane.updated", at: frame.at, threadId: frame.out.threadId, lane })
}

function laneWith(before: Lane | undefined, patch: LanePatch, frame: TaskFrame): Lane {
  return {
    ...before,
    id: patch.id,
    threadId: frame.out.threadId,
    kind: "activity",
    title: patch.title,
    status: patch.status,
    at: before?.at ?? frame.at,
    handle: patch.id,
  }
}

function onTaskStarted(state: TaskState, raw: RawTaskStarted, frame: TaskFrame): void {
  const id = str(raw.task_id)
  const description = str(raw.description)
  if (id === undefined || description === undefined) return
  rememberTaskParent(state.links, id, raw)
  if (raw.skip_transcript === true) {
    state.hidden.add(id)
    return
  }
  state.hidden.delete(id)
  const before = state.lanes.get(id)
  if (terminal(before)) return
  emitLane(state, laneWith(before, { id, title: description, status: "running" }, frame), frame)
}

function taskProgressOf(raw: unknown): TaskRun | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const msg = raw as RawTaskProgress
  const id = str(msg.task_id)
  const description = str(msg.description)
  if (id === undefined || description === undefined) return undefined
  const agentType = str(msg.subagent_type)
  const lastTool = str(msg.last_tool_name)
  return {
    id, description, toolUses: num(msg.usage?.tool_uses), ms: num(msg.usage?.duration_ms),
    ...(agentType === undefined ? {} : { agentType }),
    ...(lastTool === undefined ? {} : { lastTool }),
  }
}

function progressLaneOf(raw: unknown, before: Lane | undefined, frame: TaskFrame): Lane | undefined {
  const translated = toLane(raw, frame.out.threadId, frame.at)
  if (translated === undefined) return undefined
  // 纯心跳帧不带树，不代表树被清空；started 的整批标题也比当前 agent 描述稳定。
  return { ...before, ...translated, title: before?.title ?? translated.title, at: before?.at ?? frame.at }
}

/**
 * 收一条进度，整份报出去。
 *
 * **全量而不是增量**：一次只报一条的话，「它跑完了」就得再发明一种删除事件，
 * 而漏发一次的后果是界面上留一条永远在跑的任务。全量替换没有这个失败模式。
 *
 * `description` 是引擎自己写的一句人话。**没有就整条不要**——
 * 拿 `last_tool_name` 拼一句「正在 Read」顶替，是 Switchback 在替引擎说话。
 */
export function onTaskProgress(
  state: TaskState,
  raw: unknown,
  at: number,
  out: TaskOut,
): void {
  const task = taskProgressOf(raw)
  if (task === undefined) return
  rememberTaskParent(state.links, task.id, raw)
  const before = state.lanes.get(task.id)
  if (state.hidden.has(task.id) || terminal(before)) return
  const frame = { at, out }
  state.active.set(task.id, task)
  emitTasks(state, frame)
  // 同一帧再报一条 lane。**两者不是重复，是两种寿命**：
  // `tasks.updated` 是活状态（在 journal 的 SKIP 名单里，轮次一结束就清），
  // 服务的是转录区末尾那行「它在干什么」；`lane.updated` 是**内容**——落盘、⌘R 回得来。
  // 而 workflow 恰恰是**主循环收工之后**才跑起来的，那时 `tasks` 那条路已经整块不渲染了。
  const lane = progressLaneOf(raw, before, frame)
  if (lane === undefined) return
  emitLane(state, lane, frame)
  // workflow 的完整树若已自然收口，不等可能丢失的下一条 edge 才撤活动行。
  updateActive(state, task.id, { status: lane.status }, frame)
}

function updateActive(
  state: TaskState,
  id: string,
  patch: Pick<TaskPatch, "description" | "status">,
  frame: TaskFrame,
): TaskRun | undefined {
  const active = state.active.get(id)
  if (active === undefined) return undefined
  if (patch.status === "done" || patch.status === "failed") state.active.delete(id)
  else if (patch.description !== undefined) state.active.set(id, { ...active, description: patch.description })
  else return active
  emitTasks(state, frame)
  return active
}

function patchedStatus(before: Lane | undefined, reported: Lane["status"] | undefined): Lane["status"] {
  if ((reported === "running" || reported === "paused") && terminal(before)) return before?.status ?? "running"
  return reported ?? before?.status ?? "running"
}

function taskPatchOf(raw: RawTaskUpdated): TaskPatch | undefined {
  const id = str(raw.task_id)
  if (id === undefined || raw.patch === undefined) return undefined
  const description = str(raw.patch.description)
  const status = STATUS[str(raw.patch.status) ?? ""]
  const error = str(raw.patch.error)
  if ([description, status, error].every((value) => value === undefined)) return undefined
  return { id, ...(description === undefined ? {} : { description }), ...(status === undefined ? {} : { status }),
    ...(error === undefined ? {} : { error }) }
}

function onTaskUpdated(state: TaskState, raw: RawTaskUpdated, frame: TaskFrame): void {
  const patch = taskPatchOf(raw)
  if (patch === undefined || state.hidden.has(patch.id)) return
  const before = state.lanes.get(patch.id)
  const status = patchedStatus(before, patch.status)
  const active = updateActive(state, patch.id, { description: patch.description, status }, frame)
  const title = patch.description ?? before?.title ?? active?.description
  if (title === undefined) return
  const lane = laneWith(before, { id: patch.id, title, status }, frame)
  const error = status === "failed" ? patch.error : undefined
  emitLane(state, error === undefined ? lane : { ...lane, summary: error }, frame)
}

function withUsage(lane: Lane, used: unknown): Lane {
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return lane
  return {
    ...lane,
    progress: { nodes: lane.progress?.nodes ?? [], ...lane.progress, budget: { used } },
  }
}

function taskFinalOf(raw: RawTaskNotification): TaskFinal | undefined {
  const id = str(raw.task_id)
  const status = STATUS[str(raw.status) ?? ""]
  if (id === undefined || (status !== "done" && status !== "failed")) return undefined
  const summary = str(raw.summary)
  return {
    id, status, skipTranscript: raw.skip_transcript === true, used: raw.usage?.total_tokens,
    ...(summary === undefined ? {} : { summary }),
  }
}

function hideFinal(state: TaskState, task: TaskFinal, before: Lane | undefined): boolean {
  if (!state.hidden.has(task.id) && (!task.skipTranscript || before !== undefined)) return false
  state.hidden.add(task.id)
  return true
}

function onTaskNotification(state: TaskState, raw: RawTaskNotification, frame: TaskFrame): void {
  const task = taskFinalOf(raw)
  if (task === undefined) return
  rememberTaskParent(state.links, task.id, raw)
  const before = state.lanes.get(task.id)
  const active = updateActive(state, task.id, { status: task.status }, frame)
  if (hideFinal(state, task, before)) {
    return
  }
  const title = before?.title ?? active?.description ?? task.summary
  if (title === undefined) return
  const lane = laneWith(before, { id: task.id, title, status: task.status }, frame)
  const summarized = task.summary === undefined ? lane : { ...lane, summary: task.summary }
  emitLane(state, withUsage(summarized, task.used), frame)
}

/** 四种公开 system 消息按 task_id 汇成同一条生命周期。 */
export function onTaskMessage(state: TaskState, raw: unknown, at: number, out: TaskOut): void {
  if (typeof raw !== "object" || raw === null) return
  const frame = { at, out }
  const subtype = str((raw as { subtype?: unknown }).subtype)
  if (subtype === "task_started") onTaskStarted(state, raw as RawTaskStarted, frame)
  else if (subtype === "task_progress") onTaskProgress(state, raw, at, out)
  else if (subtype === "task_updated") onTaskUpdated(state, raw as RawTaskUpdated, frame)
  else if (subtype === "task_notification") onTaskNotification(state, raw as RawTaskNotification, frame)
}

/** 轮次收工：清空并报一次空的。**不报的话界面上那几条会一直挂着。** */
export function clearTasks(
  state: TaskState,
  at: number,
  out: TaskOut,
): void {
  if (state.active.size === 0) return
  state.active.clear()
  emitTasks(state, { at, out })
}
