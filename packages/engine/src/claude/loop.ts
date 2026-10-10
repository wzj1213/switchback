import type { query } from "@anthropic-ai/claude-agent-sdk"
import type { ErrorItem, Trust } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createTaskState, onTaskMessage, type TaskState } from "./tasks.js"
import { createPlanState } from "./plan.js"
import { modeAxis } from "./trust.js"
import { toClaudeLimits } from "./limits.js"
import { emitInformational } from "./informational.js"
import { captureTerminalCommands, emitChangedCommands } from "./commands.js"
import { emitRetry } from "./retry.js"
import { emitConversationReset } from "./conversation.js"
import { emitCompaction } from "./compaction.js"
import type { RawUsage } from "./usage.js"
import { createThinkingState, emitThinking } from "./thinking.js"
import { emitMemoryRecall } from "./memory.js"
import { makeIdMinter, onAssistant, onToolResults, type MessageRef } from "./messages.js"
import { createRetractionState, onModelRefusal } from "./retraction.js"
import { emitLocalCommandOutput } from "./local-command.js"
import { closeHooks, createHookState, onHookMessage, type HookState } from "./hooks.js"
import { createDenialState, onPermissionDenied } from "./denials.js"
import { emitNotification } from "./notification.js"
import { emitPluginInstall } from "./plugin-install.js"
import { emitElicitationComplete } from "./elicitation-complete.js"
import { createStream, onStreamEvent, type StreamState } from "./stream.js"
import { endTurn, onResult, type ResultContext } from "./result.js"
import type { RawLoopMessage } from "./loop-wire.js"
import { createHaltState, haltAgain, type HaltState } from "./halt.js"
import {
  createSidechainState,
  onSidechainMessage,
  settleSidechains,
  syncSidechainTask,
  type SidechainState,
} from "./sidechain.js"

/**
 * 当前轮次。宿主在 `prompt()` 时写入，引擎在收到 result 时清空。
 * 用可变引用而不是参数，是因为消息循环跑在会话整个生命周期上，
 * 而轮次会在这期间反复开合。
 */
export interface TurnRef extends MessageRef {
  /** init 明确标为依赖本地终端的命令；Switchback 只有 GUI，不向两端菜单冒充可用。 */
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
  /** 已送达、尚未等到原生阶段结果的即时插话数。 */
  pendingSteers: number
  /** 最近一次主 agent API 请求的用量；result 是整轮汇总，不能拿来算当前上下文。 */
  latestUsage?: RawUsage
  /** 一个 Switchback 回合可能被 steer 切成几段原生结果；输出量在这里合起来。 */
  outputTokens?: number
  /** Claude 明确标出 parent_tool_use_id 的子 agent 转录；各 lane 独立维护消息身份。 */
  sidechains: SidechainState
  /** 按过停止、回执说还有消息照跑的那一轮（见 `halt.ts`）。 */
  halt: HaltState
}

export function createTurnRef(onInit: (at: number) => void): TurnRef {
  return {
    current: undefined, seq: 0, tools: new Map(), notices: new Map(), terminalCommands: new Set(), onInit,
    tasks: createTaskState(), plan: createPlanState(), thinking: createThinkingState(),
    retractions: createRetractionState(), hooks: createHookState(), denials: createDenialState(),
    stream: createStream(), pendingSteers: 0, sidechains: createSidechainState(), halt: createHaltState(),
  }
}

interface DispatchContext extends ResultContext {
  trust: () => Trust
  /** init 说明模型已知，重新同步随模型变化的窗口。 */
  onReady: () => void
  onMcpStatuses?: (statuses: unknown, at: number) => void
}

/** 逐字增量没有轮次就不接：那不属于宿主发起的任何一次请求。 */
function onStream(msg: RawLoopMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  if (turnId === undefined) return
  onStreamEvent(ref.stream, msg.event, {
    turnId, at, nextId: makeIdMinter(ref, turnId), emit: req.emit,
  })
}

function emitModelRefusal(msg: RawLoopMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  onModelRefusal(msg, ref.retractions, {
    turnId, at, emit: req.emit, tools: ref.tools, plan: ref.plan, onModel: req.onModel,
    settledTools: ref.denials.settled, denialMessages: ref.denials.messages,
    ...(turnId === undefined ? {} : { nextId: makeIdMinter(ref, turnId) }),
  })
}

function emitCurrentSystem(msg: RawLoopMessage, ref: TurnRef, req: StartRequest, at: number): void {
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

function onSystem(msg: RawLoopMessage, ref: TurnRef, ctx: DispatchContext, at: number): void {
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
    ctx.onMcpStatuses?.(msg.mcp_servers, at)
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
  syncSidechainTask(ref.sidechains, ref.tasks, msg, { turnId: ref.current, req, at })
  emitChangedCommands(msg, {
    at, threadId: req.threadId, terminalCommands: ref.terminalCommands, emit: req.emit,
  })
}

/** Task 子 agent 的 assistant/user/增量另有 activity 帧；混进主线会造出假的失败工具。 */
function isSidechain(msg: RawLoopMessage): boolean {
  const carriesTranscript = msg.type === "assistant" || msg.type === "user" || msg.type === "stream_event"
  return carriesTranscript && typeof msg.parent_tool_use_id === "string" && msg.parent_tool_use_id !== ""
}

function onAssistantMessage(msg: RawLoopMessage, ref: TurnRef, req: StartRequest, at: number): void {
  if (msg.message?.usage !== undefined) ref.latestUsage = msg.message.usage
  onAssistant(msg, ref, req, at)
}

async function dispatch(msg: RawLoopMessage, ref: TurnRef, ctx: DispatchContext, at: number): Promise<void> {
  const { req } = ctx
  switch (msg.type) {
    case "assistant":
      onAssistantMessage(msg, ref, req, at)
      return
    case "stream_event":
      onStream(msg, ref, req, at)
      return
    case "user":
      onToolResults(msg, ref, req, at)
      return
    case "result":
      await onResult(msg, ref, ctx, at)
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
 * 消费 SDK 的消息流并翻译成 Switchback 事件。
 *
 * **不吞异常**：迭代抛出时发一条 `engine.status: crashed` 再重新抛出，
 * 让 `dispose()` 的等待方看得到失败，而不是静默结束。
 */
type LoopOptions = Omit<DispatchContext, "req"> | (() => Trust)

function contextOf(req: StartRequest, options: LoopOptions): DispatchContext {
  if (typeof options !== "function") return { req, ...options }
  return {
    req,
    trust: options,
    context: () => Promise.resolve(undefined),
    onReady: () => undefined,
    onMcpStatuses: () => undefined,
  }
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
      const raw = msg as RawLoopMessage
      const at = Date.now()
      haltAgain(handle, ref, raw.type)
      if (isSidechain(raw)) onSidechainMessage(ref.sidechains, raw, req, at)
      else await dispatch(raw, ref, ctx, at)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const at = Date.now()
    closeHooks(ref.hooks, { emit: req.emit, now: () => at })
    settleSidechains(ref.sidechains, req, at)
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
  settleSidechains(ref.sidechains, req, at)
  // 正常走完循环但没收到 result 也算没跑完——同样要落终态，理由同上
  endTurn(ref, req, at, "failed")
  req.emit({ type: "engine.status", at, threadId: req.threadId, status: "exited" })
}
