import type { Event, ItemId, PlanStep, ThreadId, TurnId } from "@switchback/protocol"

/**
 * claude 的待办清单 → Switchback 的 `plan` item。
 *
 * ## 全部来自实测（2026-08-19）
 *
 * ```
 * TaskCreate {subject, description, activeForm}  → "Task #1 created successfully: 读 a.txt"
 * TaskUpdate {taskId: "1", status: "in_progress"} → "Updated task #1 status"
 * ```
 *
 * 三件事值得记：
 *
 * 1. **模型真调的是 `TaskCreate` / `TaskUpdate`**，不是 SDK 里同样声明着的 `TodoWrite`
 *   （这台机器上一次都没被调过）。
 * 2. **它们不经过 `canUseTool`**，所以 Switchback 的判定层看不见它们——
 *    方案乙担心的「只读档会拒掉待办」复现不了。
 * 3. **id 是按创建顺序递增的**（1、2、3…）。所以这里按顺序发号，
 *    而不是去正则抠 `Task #(\\d+)` 那句英文——**文案会变，顺序不会**。
 *
 * ## 为什么显示端一行都不用写
 *
 * `PlanItem` 和 `<Plan steps>` 早就有了，只是此前**只有 ACP 一路在发**。
 * 这个文件补的就是 claude 那一路的产出端。
 */

const CREATE = "TaskCreate"
const UPDATE = "TaskUpdate"

/** 待办那一族。**认出来就不画成工具行**——计划卡已经在说同一件事，画两遍是噪声。 */
const QUIET: ReadonlySet<string> = new Set([CREATE, UPDATE, "TaskList", "TaskGet"])

export interface PlanState {
  /** 保序：**Map 的插入序就是 claude 的编号序**，见上面第 3 条。 */
  steps: Map<string, PlanStep>
  /** 这一轮的 plan item id。复用它才是「同一份计划在更新」，而不是每改一步就多一张卡。 */
  itemId: ItemId | undefined
}

export function createPlanState(): PlanState {
  return { steps: new Map(), itemId: undefined }
}

interface RawToolUse {
  type?: unknown
  name?: unknown
  input?: { subject?: unknown; taskId?: unknown; status?: unknown }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/** 这条内容块是不是待办工具。**调用方据此把它从工具行里滤掉。** */
export function isPlanTool(block: unknown): boolean {
  const raw = block as RawToolUse | undefined
  return raw?.type === "tool_use" && typeof raw.name === "string" && QUIET.has(raw.name)
}

/**
 * claude 的状态词 → Switchback 的四态。
 *
 * **认不出的一律当 `pending`**：一个状态没认出来，最坏的表现是「显示成还没做」，
 * 而不是「显示成做完了」——猜错的方向必须是保守的那一边。
 */
function statusOf(raw: unknown): PlanStep["status"] {
  const v = str(raw)
  if (v === "in_progress") return "in_progress"
  if (v === "completed" || v === "done") return "done"
  if (v === "cancelled" || v === "deleted" || v === "dropped") return "dropped"
  return "pending"
}

/** 吃一条待办工具调用。返回计划有没有变——没变就不必重发一次 item。 */
export function feedPlan(state: PlanState, block: unknown): boolean {
  const raw = block as RawToolUse | undefined
  const input = raw?.input
  if (raw?.name === CREATE) {
    const text = str(input?.subject)
    if (text === undefined) return false
    // **按顺序发号**：claude 的 id 就是创建序（实测 1、2、3…）
    state.steps.set(String(state.steps.size + 1), { text, status: "pending" })
    return true
  }
  if (raw?.name !== UPDATE) return false
  const id = str(input?.taskId)
  if (id === undefined) return false
  const step = state.steps.get(id)
  // **认不出的 id 就丢掉，不凭空建一条**。claude 自己的面板会拿 taskId 当标题建一条，
  // 那在实时面板上无所谓；而 Switchback 的 transcript 是事后要读的记录，
  // 一条内容是 id 的步骤读的人只会以为自己记错了
  if (step === undefined) return false
  state.steps.set(id, { ...step, status: statusOf(input?.status) })
  return true
}

/** 把当前计划发出去。**复用 itemId**，所以界面上是同一张卡在变。 */
export function emitPlan(
  state: PlanState,
  turnId: TurnId,
  at: number,
  out: { threadId: ThreadId; emit: (event: Event) => void; nextId: () => ItemId },
): void {
  if (state.steps.size === 0) return
  const existing = state.itemId
  const id = existing ?? out.nextId()
  state.itemId = id
  out.emit({
    type: existing === undefined ? "item.started" : "item.updated",
    at,
    item: { id, turnId, at, kind: "plan", steps: [...state.steps.values()] },
  })
}

/** 轮次收工：下一轮是新的一份计划，不该接着上一轮画。 */
export function resetPlan(state: PlanState): void {
  state.steps.clear()
  state.itemId = undefined
}
