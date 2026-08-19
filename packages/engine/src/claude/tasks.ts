import type { Event, TaskRun, ThreadId } from "@omni/protocol"

/**
 * 子 agent 在干什么。
 *
 * ## 数据从哪来
 *
 * SDK 的 `{type:"system", subtype:"task_progress"}`。**实测抓到的一帧**
 *（起一个 Task 子 agent 读两个文件）：
 *
 * ```json
 * { "task_id": "ace84…", "description": "Reading b.txt",
 *   "subagent_type": "general-purpose", "last_tool_name": "Read",
 *   "usage": { "tool_uses": 3, "duration_ms": 4186 } }
 * ```
 *
 * 同一族还有 `task_started` / `task_updated` / `task_notification`——
 * **这一版仍然只接 `task_progress` 一种**。另三种的形状 2026-08-19 在 **workflow
 * 那一路**抓到了（`task_started` 带 `task_type:"local_workflow"` / `workflow_name` /
 * 完整脚本源码；`task_updated` 是 `patch{status,end_time}`；`task_notification` 带
 * `output_file` / `summary` / `usage`），但 **Task 工具那一路还没抓**。这里现在只服务
 * Task 子 agent，拿 workflow 的形状去接另一路，是拿一次实测盖两条不同的路径。
 *
 * ## `workflow_progress`：上一版判它不存在，判据用错了形状
 *
 * 它**不是一种 subtype，是 `task_progress` 帧上的一个字段**。上一版按 subtype 名去 grep
 *（`sdk.d.ts` 与 `sdk.mjs` 各 0 处）就判它不存在——0 处是真的，**公开类型至今没声明它**，
 * 但它就搭在这个函数已经在解析的那一帧上。2026-08-19 活体抓到（10 帧里 4 帧带）：
 *
 * ```json
 * { "subtype": "task_progress", "task_id": "w4zk4icbn",
 *   "description": "Read: read:alpha.txt", "last_tool_name": "read:alpha.txt",
 *   "workflow_progress": [
 *     { "type": "workflow_phase", "index": 1, "title": "Read" },
 *     { "type": "workflow_agent", "index": 1, "label": "read:alpha.txt",
 *       "phaseIndex": 1, "phaseTitle": "Read", "agentId": "a5403b31…", "state": "done",
 *       "tokens": 11031, "toolCalls": 2, "durationMs": 4673,
 *       "lastToolName": "StructuredOutput", "lastToolSummary": "红" }] }
 * ```
 *
 * 一整个 workflow 共用**一个 `task_id`**：`description` 取的是这一批里最后一个报进度的
 * agent，`last_tool_name` 填的是那个 agent 的 `label`（**不是工具名**，所以和 `description`
 * 后半段重复）。每-agent 明细全在这个被丢掉的字段里。带数组的帧都是状态变化帧；
 * 纯进度帧按 10s 节流，那条分支还没跑到（那一跑全程只有 6.7s）。
 *
 * ## 但先别急着接：workflow 现在**整个不显示**
 *
 * `Workflow` 工具**立刻返回**（`Workflow launched in background`），workflow 在后台跑，
 * 主循环几秒就收工。于是 `onResult` 清空任务并发 `turn.completed` → `TurnStatus` 因
 * `turn === undefined` 整块不渲染；后面那些 `task_progress` 照常到、照常进 store，
 * **没有任何东西渲染它**。接这个字段之前要先解决这个——见 `docs/工程时间线.md` 同日那条。
 */

/** 这一轮里每个任务最后一次报的进度。键是引擎给的 `task_id`。 */
export type TaskState = Map<string, TaskRun>

export function createTaskState(): TaskState {
  return new Map()
}

interface RawTaskProgress {
  task_id?: unknown
  description?: unknown
  subagent_type?: unknown
  last_tool_name?: unknown
  usage?: { tool_uses?: unknown; duration_ms?: unknown }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * 收一条进度，整份报出去。
 *
 * **全量而不是增量**：一次只报一条的话，「它跑完了」就得再发明一种删除事件，
 * 而漏发一次的后果是界面上留一条永远在跑的任务。全量替换没有这个失败模式。
 *
 * `description` 是引擎自己写的一句人话。**没有就整条不要**——
 * 拿 `last_tool_name` 拼一句「正在 Read」顶替，是 omni 在替引擎说话。
 */
export function onTaskProgress(
  state: TaskState,
  raw: unknown,
  at: number,
  out: { threadId: ThreadId; emit: (event: Event) => void },
): void {
  // **认不出的形状静默丢弃**，和 `acp/update.ts` 的 `handleUpdate` 同一条原则：
  // 协议一直在加新东西，多一种不该掀翻整轮
  if (typeof raw !== "object" || raw === null) return
  const msg = raw as RawTaskProgress
  const id = str(msg.task_id)
  const description = str(msg.description)
  if (id === undefined || description === undefined) return
  state.set(id, {
    id,
    description,
    ...(str(msg.subagent_type) === undefined ? {} : { agentType: str(msg.subagent_type) as string }),
    ...(str(msg.last_tool_name) === undefined ? {} : { lastTool: str(msg.last_tool_name) as string }),
    toolUses: num(msg.usage?.tool_uses),
    ms: num(msg.usage?.duration_ms),
  })
  out.emit({ type: "tasks.updated", at, threadId: out.threadId, tasks: [...state.values()] })
}

/** 轮次收工：清空并报一次空的。**不报的话界面上那几条会一直挂着。** */
export function clearTasks(
  state: TaskState,
  at: number,
  out: { threadId: ThreadId; emit: (event: Event) => void },
): void {
  if (state.size === 0) return
  state.clear()
  out.emit({ type: "tasks.updated", at, threadId: out.threadId, tasks: [] })
}
