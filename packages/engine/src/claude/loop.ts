import type { query } from "@anthropic-ai/claude-agent-sdk"
import type { ErrorItem, Trust, TurnStatus } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { clearTasks, createTaskState, onTaskMessage, type TaskState } from "./tasks.js"
import { createPlanState, resetPlan } from "./plan.js"
import { turnError, turnStatus } from "./translate.js"
import { modeAxis } from "./trust.js"
import { toClaudeLimits } from "./limits.js"
import { emitInformational } from "./informational.js"
import { captureTerminalCommands, emitChangedCommands } from "./commands.js"
import { emitRetry } from "./retry.js"
import { emitConversationReset } from "./conversation.js"
import { emitCompaction } from "./compaction.js"
import { claudeUsage, type RawUsage } from "./usage.js"
import { clearThinking, createThinkingState, emitThinking } from "./thinking.js"
import { emitMemoryRecall } from "./memory.js"
import { makeIdMinter, onAssistant, onToolResults, type MessageRef } from "./messages.js"
import { clearRetractions, createRetractionState, onModelRefusal } from "./retraction.js"
import { emitLocalCommandOutput } from "./local-command.js"
import { closeHooks, createHookState, onHookMessage, type HookState } from "./hooks.js"
import {
  applyResultDenials, clearDenials, createDenialState, onPermissionDenied,
} from "./denials.js"
import { emitNotification } from "./notification.js"
import { emitPluginInstall } from "./plugin-install.js"
import { emitElicitationComplete } from "./elicitation-complete.js"
import { createStream, onStreamEvent, resetStream, type RawStreamEvent, type StreamState } from "./stream.js"

/** SDK 消息的结构性最小类型——理由同 translate.ts。 */
interface RawMessage {
  type: string
  /** `stream_event` 的原生载荷；其余事件认不出时照旧忽略。 */
  event?: RawStreamEvent
  subtype?: string
  is_error?: boolean
  message?: { content?: unknown; model?: unknown }
  usage?: RawUsage
  content?: unknown
  level?: unknown
  tool_use_id?: unknown
  rate_limit_info?: unknown
  result?: unknown
  errors?: unknown
  commands?: unknown
  terminal_slash_commands?: unknown
  attempt?: unknown
  max_retries?: unknown
  retry_delay_ms?: unknown
  error_status?: unknown
  error?: unknown
  name?: unknown
  mcp_server_name?: unknown
  elicitation_id?: unknown
  status?: unknown
  compact_result?: unknown
  compact_error?: unknown
  compact_metadata?: unknown
  estimated_tokens?: unknown
  /** 可续跑 session id：初次在 init，`/clear` 后首次在 result。 */
  session_id?: string
  new_conversation_id?: unknown
  permissionMode?: string
  uuid?: unknown
  supersedes?: unknown
  direction?: unknown
  scope?: unknown
  original_model?: unknown
  fallback_model?: unknown
  retracted_message_uuids?: unknown
  hook_id?: unknown
  hook_name?: unknown
  hook_event?: unknown
  stdout?: unknown
  stderr?: unknown
  output?: unknown
  exit_code?: unknown
  outcome?: unknown
  permission_denials?: unknown
  key?: unknown
  text?: unknown
  priority?: unknown
  color?: unknown
  timeout_ms?: unknown
}

/**
 * 当前轮次。宿主在 `prompt()` 时写入，引擎在收到 result 时清空。
 * 用可变引用而不是参数，是因为消息循环跑在会话整个生命周期上，
 * 而轮次会在这期间反复开合。
 */
export interface TurnRef extends MessageRef {
  /** init 明确标为依赖本地终端的命令；omni 只有 GUI，不向两端菜单冒充可用。 */
  terminalCommands: Set<string>
  /** init 已被消息循环消费；命令目录据此避开终端标记与开场查询的竞态。 */
  onInit: (at: number) => void
  /** 同一轮的 API 重试原地更新，不把指数退避画成一墙重复错误。 */
  retry?: ErrorItem
  /** 这一轮里子 agent 报的进度。**活状态，轮次收工就清**（见 `tasks.ts`）。 */
  tasks: TaskState
  /** Hook 可以异步跨过轮次边界，按原生 hook_id 留在会话引用里配对。 */
  hooks: HookState
  /** 一条 assistant 消息的增量身份表；完整收尾复用这里已铸好的 id。 */
  stream: StreamState
}

export function createTurnRef(onInit: (at: number) => void): TurnRef {
  return {
    current: undefined, seq: 0, tools: new Map(), notices: new Map(), terminalCommands: new Set(), onInit,
    tasks: createTaskState(), plan: createPlanState(), thinking: createThinkingState(),
    retractions: createRetractionState(), hooks: createHookState(), denials: createDenialState(),
    stream: createStream(),
  }
}

/**
 * 轮次收工时清扫还挂着的工具调用。
 *
 * 中断或出错时不会再有 `tool_result` 回来，那条工具行就**永远停在 `running`**。
 * codex 驱动上踩到过一模一样的坑，两边都要扫。
 */
function sweepTools(ref: TurnRef, req: StartRequest, at: number, status: TurnStatus): void {
  const ending = status === "interrupted" ? "interrupted" : "failed"
  for (const item of ref.tools.values()) {
    req.emit({
      type: "item.updated",
      at,
      item:
        status === "completed"
          ? { ...item, status: "failed", error: "Claude 在轮次结束前没有报告这次工具调用的结果。" }
          : { ...item, status: ending },
    })
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
  clearThinking(ref.thinking, { at, threadId: req.threadId, turnId, emit: req.emit })
  ref.current = undefined
  sweepTools(ref, req, at, status)
  ref.notices.clear()
  clearRetractions(ref.retractions)
  clearDenials(ref.denials)
  resetStream(ref.stream)
  ref.retry = undefined
  // 子 agent 跟着轮次一起收：一轮结束还留着，界面上就是一串早就跑完了却还在转的任务
  clearTasks(ref.tasks, at, req)
  resetPlan(ref.plan)
  req.emit({ type: "turn.completed", at, turnId, status })
}

function onResult(msg: RawMessage, ref: TurnRef, ctx: DispatchContext, at: number): void {
  const { req } = ctx
  // `/clear` 后不会再发 init；新的可续跑 session id 首次出现在这条 result 上。
  if (msg.session_id !== undefined) req.onHandle?.(msg.session_id)
  const turnId = ref.current
  applyResultDenials(msg, ref.denials, ref.tools, { at, emit: req.emit })
  if (turnId !== undefined) {
    clearThinking(ref.thinking, { at, threadId: req.threadId, turnId, emit: req.emit })
  }
  ref.current = undefined
  resetStream(ref.stream)
  clearTasks(ref.tasks, at, req)
  resetPlan(ref.plan)
  if (msg.usage !== undefined) {
    req.emit({
      type: "usage.updated",
      at,
      threadId: req.threadId,
      engine: "claude",
      usage: claudeUsage(msg.usage, ctx.window()),
    })
  }
  if (turnId === undefined) {
    clearDenials(ref.denials)
    return
  }
  const status = turnStatus(msg.subtype ?? "", msg.is_error === true)
  sweepTools(ref, req, at, status)
  ref.notices.clear()
  clearRetractions(ref.retractions)
  clearDenials(ref.denials)
  ref.retry = undefined
  const error = status === "failed" ? turnError(msg) : undefined
  req.emit({ type: "turn.completed", at, turnId, status, ...(error === undefined ? {} : { error }) })
}

interface DispatchContext {
  req: StartRequest
  trust: () => Trust
  /** 消息帧不带窗口上限，由会话通过原生控制请求另取。 */
  window: () => number | undefined
  /** init 说明模型已知，重新同步随模型变化的窗口。 */
  onReady: () => void
}

/** 逐字增量没有轮次就不接：那不属于宿主发起的任何一次请求。 */
function onStream(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  if (turnId === undefined) return
  onStreamEvent(ref.stream, msg.event, {
    turnId, at, nextId: makeIdMinter(ref, turnId), emit: req.emit,
  })
}

function emitModelRefusal(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  onModelRefusal(msg, ref.retractions, {
    turnId, at, emit: req.emit, tools: ref.tools, plan: ref.plan, onModel: req.onModel,
    settledTools: ref.denials.settled, denialMessages: ref.denials.messages,
    ...(turnId === undefined ? {} : { nextId: makeIdMinter(ref, turnId) }),
  })
}

function emitCurrentSystem(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  if (turnId === undefined) return
  const itemContext = { turnId, at, nextId: makeIdMinter(ref, turnId), emit: req.emit }
  if (msg.subtype === "informational") emitInformational(msg, ref.notices, itemContext)
  if (msg.subtype === "local_command_output") emitLocalCommandOutput(msg, itemContext)
  emitThinking(ref.thinking, msg, {
    turnId, at, threadId: req.threadId, emit: req.emit,
  })
  emitCompaction(msg, ref.notices, { turnId, at, emit: req.emit })
  emitMemoryRecall(msg, itemContext)
  if (msg.subtype === "api_retry") {
    ref.retry = emitRetry(msg, ref.retry, { turnId, at, emit: req.emit }) ?? ref.retry
  }
}

function onSystem(msg: RawMessage, ref: TurnRef, ctx: DispatchContext, at: number): void {
  const { req } = ctx
  if (msg.subtype === "notification") {
    emitNotification(msg, { threadId: req.threadId, at, emit: req.emit })
  }
  if (msg.subtype === "plugin_install") {
    emitPluginInstall(msg, { threadId: req.threadId, at, emit: req.emit })
  }
  if (msg.subtype === "elicitation_complete") {
    emitElicitationComplete(msg, { threadId: req.threadId, at, emit: req.emit })
  }
  captureTerminalCommands(msg, ref.terminalCommands)
  if (msg.permissionMode !== undefined) {
    req.onEngineState?.({ axes: [modeAxis(msg.permissionMode, ctx.trust())] })
  }
  if (msg.subtype === "init") {
    if (msg.session_id !== undefined) req.onHandle?.(msg.session_id)
    req.emit({ type: "engine.status", at, threadId: req.threadId, status: "ready" })
    ref.onInit(at)
    ctx.onReady()
  }
  emitCurrentSystem(msg, ref, req, at)
  onHookMessage(ref.hooks, msg, {
    threadId: req.threadId, turnId: () => ref.current, emit: req.emit, now: () => at,
  })
  onPermissionDenied(msg, ref.denials, ref.tools, { at, emit: req.emit })
  emitModelRefusal(msg, ref, req, at)
  onTaskMessage(ref.tasks, msg, at, req)
  emitChangedCommands(msg, {
    at, threadId: req.threadId, terminalCommands: ref.terminalCommands, emit: req.emit,
  })
}

function dispatch(msg: RawMessage, ref: TurnRef, ctx: DispatchContext, at: number): void {
  const { req } = ctx
  switch (msg.type) {
    case "assistant":
      onAssistant(msg, ref, req, at)
      return
    case "stream_event":
      onStream(msg, ref, req, at)
      return
    case "user":
      onToolResults(msg, ref, req, at)
      return
    case "result":
      onResult(msg, ref, ctx, at)
      return
    case "rate_limit_event": {
      const limits = toClaudeLimits(msg.rate_limit_info)
      if (limits !== undefined) req.emit({ type: "limits.updated", at, engine: "claude", limits })
      return
    }
    case "conversation_reset": {
      const turnId = ref.current
      emitConversationReset(msg, {
        threadId: req.threadId,
        ...(turnId === undefined ? {} : { turnId }),
        at,
        ...(turnId === undefined ? {} : { nextId: makeIdMinter(ref, turnId) }),
        emit: req.emit,
      })
      return
    }
    case "system":
      // task 生命周期也走 system；认不出的 subtype 由各适配器自己静默略过
      onSystem(msg, ref, ctx, at)
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
type LoopOptions = Omit<DispatchContext, "req"> | (() => Trust)

function contextOf(req: StartRequest, options: LoopOptions): DispatchContext {
  if (typeof options !== "function") return { req, ...options }
  return { req, trust: options, window: () => undefined, onReady: () => undefined }
}

export async function runMessageLoop(
  handle: ReturnType<typeof query>,
  req: StartRequest,
  ref: TurnRef,
  options: LoopOptions,
): Promise<void> {
  const ctx = contextOf(req, options)
  try {
    for await (const msg of handle) {
      dispatch(msg as RawMessage, ref, ctx, Date.now())
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const at = Date.now()
    closeHooks(ref.hooks, { emit: req.emit, now: () => at })
    /**
     * **必须先把轮次落终态，再抛。**
     * 只发 `engine.status: crashed` 会让宿主的 `entry.turn` 和 running 状态永远留着：
     * 一个一直在涨的计时器、和一个点了只会再弹一条横幅的「停止」。
     * 而且输入框会被那个假的「正在跑」永久锁住。
     */
    endTurn(ref, req, at, "failed")
    req.emit({ type: "engine.status", at, threadId: req.threadId, status: "crashed", detail })
    throw error
  }
  const at = Date.now()
  closeHooks(ref.hooks, { emit: req.emit, now: () => at })
  // 正常走完循环但没收到 result 也算没跑完——同样要落终态，理由同上
  endTurn(ref, req, at, "failed")
  req.emit({ type: "engine.status", at, threadId: req.threadId, status: "exited" })
}
