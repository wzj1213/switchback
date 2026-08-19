import type { query } from "@anthropic-ai/claude-agent-sdk"
import type { ItemId, ToolCallItem, TurnId, TurnStatus } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { clearTasks, onTaskProgress, type TaskState } from "./tasks.js"
import { emitPlan, feedPlan, isPlanTool, resetPlan, type PlanState } from "./plan.js"
import { applyResult, assistantItems, toolResults, turnStatus } from "./translate.js"

/** SDK 消息的结构性最小类型——理由同 translate.ts。 */
interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface RawMessage {
  type: string
  subtype?: string
  is_error?: boolean
  message?: { content?: unknown }
  usage?: RawUsage
  /** SDK 的会话 id。续跑要靠它，而它**只在 `system/init` 里到达**，比 start() 晚。 */
  session_id?: string
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0)

/**
 * Claude 的用量。
 *
 * 上下文占用 = 这次请求送上去的输入（含缓存命中的那部分）+ 产出。
 * **缓存命中必须算进去**——它省的是钱，不是上下文：那些 token 照样占窗口。
 *
 * 窗口大小 SDK 不给（它随模型变），所以 `contextWindow` 缺席，
 * 界面上就只显示数字不画进度条。宁可少画一条，也不要照一个猜出来的分母画。
 */
function usageOf(raw: RawUsage): { contextUsed: number } {
  return {
    contextUsed:
      num(raw.input_tokens) +
      num(raw.cache_read_input_tokens) +
      num(raw.cache_creation_input_tokens) +
      num(raw.output_tokens),
  }
}

/**
 * 当前轮次。宿主在 `prompt()` 时写入，引擎在收到 result 时清空。
 * 用可变引用而不是参数，是因为消息循环跑在会话整个生命周期上，
 * 而轮次会在这期间反复开合。
 */
export interface TurnRef {
  current: TurnId | undefined
  /** item id 序号，跨轮递增，保证同一会话内不重复 */
  seq: number
  /**
   * 已发出但还没收到结果的工具调用，键是 Claude 的 tool_use id（也是我们的 item id）。
   * `item.updated` 要带整条 item，所以必须把它留着。
   */
  tools: Map<ItemId, ToolCallItem>
  /** 这一轮里子 agent 报的进度。**活状态，轮次收工就清**（见 `tasks.ts`）。 */
  tasks: TaskState
  /** 这一轮的待办清单。**轮次收工就重置**——下一轮是新的一份，见 `plan.ts`。 */
  plan: PlanState
}

function makeIdMinter(ref: TurnRef, turnId: TurnId): () => ItemId {
  return () => {
    ref.seq += 1
    return `${turnId}:i${String(ref.seq)}`
  }
}

function onAssistant(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  // 宿主总是先开轮次再 prompt；没有轮次说明这条消息不属于任何一次请求，丢掉
  if (turnId === undefined) return
  const content = msg.message?.content
  if (!Array.isArray(content)) return
  const nextId = makeIdMinter(ref, turnId)
  // **待办工具不画成工具行**：计划卡已经在说同一件事，画两遍是噪声（见 `plan.ts`）
  let changed = false
  for (const block of content) if (isPlanTool(block)) changed = feedPlan(ref.plan, block) || changed
  if (changed) emitPlan(ref.plan, turnId, at, { threadId: req.threadId, emit: req.emit, nextId })
  for (const item of assistantItems(content.filter((b) => !isPlanTool(b)), { turnId, at, nextId })) {
    if (item.kind === "tool_call") ref.tools.set(item.id, item)
    req.emit({ type: "item.started", at, item })
  }
}

/**
 * Claude 把工具结果作为 **user 角色**的消息发回来。不认这一类，
 * 界面上的工具调用会永远停在 `running`——这个 bug 是把界面跑起来才看见的。
 */
function onToolResults(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const content = msg.message?.content
  if (!Array.isArray(content)) return
  for (const result of toolResults(content)) {
    const pending = ref.tools.get(result.toolUseId)
    if (pending === undefined) continue
    ref.tools.delete(result.toolUseId)
    req.emit({ type: "item.updated", at, item: applyResult(pending, result) })
  }
}

/**
 * 轮次收工时清扫还挂着的工具调用。
 *
 * 中断或出错时不会再有 `tool_result` 回来，那条工具行就**永远停在 `running`**。
 * codex 驱动上踩到过一模一样的坑，两边都要扫。
 */
function sweepTools(ref: TurnRef, req: StartRequest, at: number, status: TurnStatus): void {
  if (status === "completed") return
  const ending = status === "interrupted" ? "interrupted" : "failed"
  for (const item of ref.tools.values()) {
    req.emit({ type: "item.updated", at, item: { ...item, status: ending } })
  }
  ref.tools.clear()
}

/**
 * 把还挂着的轮次落成终态。**幂等**：`ref.current` 已经清掉就什么都不做——
 * 正常收工路径已经发过 `turn.completed`，这里再发一条会往 journal 多写一行。
 */
function endTurn(ref: TurnRef, req: StartRequest, at: number, status: TurnStatus): void {
  const turnId = ref.current
  if (turnId === undefined) return
  ref.current = undefined
  sweepTools(ref, req, at, status)
  // 子 agent 跟着轮次一起收：一轮结束还留着，界面上就是一串早就跑完了却还在转的任务
  clearTasks(ref.tasks, at, req)
  resetPlan(ref.plan)
  req.emit({ type: "turn.completed", at, turnId, status })
}

function onResult(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  ref.current = undefined
  clearTasks(ref.tasks, at, req)
  resetPlan(ref.plan)
  if (msg.usage !== undefined) {
    req.emit({ type: "usage.updated", at, threadId: req.threadId, usage: usageOf(msg.usage) })
  }
  if (turnId === undefined) return
  const status = turnStatus(msg.subtype ?? "", msg.is_error === true)
  sweepTools(ref, req, at, status)
  req.emit({ type: "turn.completed", at, turnId, status })
}

function dispatch(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  switch (msg.type) {
    case "assistant":
      onAssistant(msg, ref, req, at)
      return
    case "user":
      onToolResults(msg, ref, req, at)
      return
    case "result":
      onResult(msg, ref, req, at)
      return
    case "system":
      if (msg.subtype === "init") {
        if (msg.session_id !== undefined) req.onHandle?.(msg.session_id)
        req.emit({ type: "engine.status", at, threadId: req.threadId, status: "ready" })
      }
      // **只接 `task_progress` 一种**：同族还有 task_started / task_updated /
      // task_notification，但只有这一种我抓到过完整形状。照名字猜字段不会报错，
      // 只会让界面显示一条编出来的进度（见 `tasks.ts`）
      if (msg.subtype === "task_progress") onTaskProgress(ref.tasks, msg, at, req)
      return
    default:
      // 其余 30+ 种 SDKMessage 暂不进 transcript，见 README「已知限制」
      return
  }
}

/**
 * 消费 SDK 的消息流并翻译成 omni 事件。
 *
 * **不吞异常**：迭代抛出时发一条 `engine.status: crashed` 再重新抛出，
 * 让 `dispose()` 的等待方看得到失败，而不是静默结束。
 */
export async function runMessageLoop(
  handle: ReturnType<typeof query>,
  req: StartRequest,
  ref: TurnRef,
): Promise<void> {
  try {
    for await (const msg of handle) {
      dispatch(msg as RawMessage, ref, req, Date.now())
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const at = Date.now()
    /**
     * **必须先把轮次落终态，再抛。**
     *
     * 只发 `engine.status: crashed` 的话，宿主那边 `entry.turn` 和
     * `thread.status = "running"` 永远留着——用户看到的是：一条故障横幅、
     * 一个一直在涨的计时器、和一个点了只会再弹一条横幅的「停止」。
     * 而且输入框会被那个假的「正在跑」永久锁住。
     */
    endTurn(ref, req, at, "failed")
    req.emit({ type: "engine.status", at, threadId: req.threadId, status: "crashed", detail })
    throw error
  }
  const at = Date.now()
  // 正常走完循环但没收到 result 也算没跑完——同样要落终态，理由同上
  endTurn(ref, req, at, "failed")
  req.emit({ type: "engine.status", at, threadId: req.threadId, status: "exited" })
}
