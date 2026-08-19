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
 * **这一版只接 `task_progress` 一种**：它是唯一一个我真抓到过完整形状的。
 * 另外三种照着名字猜字段，猜错了不会报错，只会让界面显示一条编出来的进度。
 *
 * ## 为什么不接 `workflow_progress`
 *
 * 方案里把它当旗舰数据源，实测**SDK 里根本没有这个东西**（`sdk.d.ts` 与
 * `sdk.mjs` 各 0 处）——那条依据不在公开 SDK 里，
 * 而 SDK 是 omni 通向 claude 的唯一通道。
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
