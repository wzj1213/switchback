import type { Event, ItemId, ThreadId, ToolCallItem, TurnId, TurnStatus } from "@omni/protocol"
import { isStreamingText, itemToOmni, textOf, turnStatus } from "./translate.js"
import { readSettings, type CodexSettings } from "./settings.js"
import { onPlanUpdate } from "./plan.js"
import type {
  WireDelta,
  WireError,
  WireItem,
  WireItemLifecycle,
  WireMcpStatus,
  WirePlanUpdate,
  WireRateLimits,
  WireTokenUsage,
  WireTurnLifecycle,
} from "./wire.js"
import { emitLimits } from "./limits.js"

/**
 * codex 通知 → omni 事件。
 *
 * 有意做成模块级函数 + 显式 ctx，而不是 class 的私有方法：这样每一支都能单独测，
 * 不用先造一个会话。
 */
export interface NotifyContext {
  threadId: ThreadId
  /**
   * **codex 自己的** thread id——和上面那个 `threadId` 不是一个命名空间：
   * 那个是 omni 的会话 id，这个是引擎的。线上的通知带的是后者。
   *
   * 取值函数而不是值：它在握手之后才知道（`thread/start` 的回包），
   * 而 `NotifyContext` 在那之前就造好了。
   */
  codexThread: () => string | undefined
  /**
   * 引擎报了一份设置快照。**这一层只翻译，怎么落由驱动定**——
   * 「omni 设的和它报的对不对得上」要知道 omni 当前是哪一档，那是驱动才有的上下文。
   */
  onSettings?: (settings: CodexSettings) => void
  emit: (event: Event) => void
  /** 宿主铸造的当前轮次 id。codex 自己的 turnId 只用来判断是不是当前轮。 */
  turnId: () => TurnId | undefined
  /** codex 铸造的当前轮次 id；用于拦住上一轮迟到的通知。 */
  codexTurn?: () => string | undefined
  /** 已结算的原生轮次；新一轮等 start 回包时也不能让它们钻空子。 */
  settledTurns?: ReadonlySet<string>
  /** 通知可能先于 turn/start 回包，用首个可信通知补上原生 id。 */
  adoptCodexTurn?: (turnId: string) => void
  /** 正常通知收工时同步清掉驱动内部的两枚轮次 id。 */
  settleTurn?: () => void
  /**
   * 在途 item。审批请求只带 itemId 回来，要靠这张表说清楚在批准什么——
   * 见 `approve.ts` 开头。
   */
  inflight: Map<string, WireItem>
  /** 流式文本/命令输出的累计值；异常收尾时用它重建完整 item，避免覆盖掉已显示内容。 */
  streamed: Map<ItemId, string>
  /** 已经发过 `item.started` 的 id。文本流式 item 有内容才落地，见下。 */
  materialized: Set<ItemId>
  /**
   * MCP 服务器最近一次报的状态。**只在翻面时出声**——
   * 一次启动实测报 17 条通知，每条都弹一个横幅的话，那就不是提示是刷屏。
   */
  mcpSeen: Map<string, string>
  now: () => number
}

/** 流式文本等第一段真实内容再落地，避免空 item 打断工具分组。 */
function materialize(ctx: NotifyContext, item: WireItem, turnId: TurnId): boolean {
  if (ctx.materialized.has(item.id)) return true
  const at = ctx.now()
  const omni = itemToOmni({ ...item, text: "", summary: [], content: [] }, { turnId, at }, false)
  if (omni === undefined) return false
  ctx.materialized.add(item.id)
  ctx.emit({ type: "item.started", at, item: omni })
  return true
}

function onItemStarted(ctx: NotifyContext, params: WireItemLifecycle): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  ctx.inflight.set(params.item.id, params.item)
  const output = params.item.aggregatedOutput
  if (typeof output === "string" && output !== "") ctx.streamed.set(params.item.id, output)
  if (isStreamingText(params.item.type)) return
  const omni = itemToOmni(params.item, { turnId, at: ctx.now() }, false)
  if (omni === undefined) return
  ctx.materialized.add(omni.id)
  ctx.emit({ type: "item.started", at: ctx.now(), item: omni })
}

function onItemCompleted(ctx: NotifyContext, params: WireItemLifecycle): void {
  const turnId = ctx.turnId()
  ctx.inflight.delete(params.item.id)
  ctx.streamed.delete(params.item.id)
  if (turnId === undefined) return
  // 空的流式 item 从来没落地过，到这里也不该落地——直接丢
  if (isStreamingText(params.item.type) && !ctx.materialized.has(params.item.id)) {
    if (textOf(params.item) === "") return
    materialize(ctx, params.item, turnId)
  }
  const omni = itemToOmni(params.item, { turnId, at: ctx.now() }, true)
  if (omni === undefined) return
  ctx.materialized.add(omni.id)
  ctx.emit({ type: "item.updated", at: ctx.now(), item: omni })
}

function onDelta(ctx: NotifyContext, params: WireDelta): void {
  const turnId = ctx.turnId()
  const item = ctx.inflight.get(params.itemId)
  if (turnId === undefined || item === undefined) return
  if (!materialize(ctx, item, turnId)) return
  ctx.streamed.set(params.itemId, `${ctx.streamed.get(params.itemId) ?? ""}${params.delta}`)
  ctx.emit({ type: "item.delta", at: ctx.now(), itemId: params.itemId, append: params.delta })
}

/** 工具在 started 时已落地；增量直接追加，completed 再用聚合输出收口。 */
function onOutputDelta(ctx: NotifyContext, params: WireDelta): void {
  if (ctx.turnId() === undefined || !ctx.materialized.has(params.itemId)) return
  ctx.streamed.set(params.itemId, `${ctx.streamed.get(params.itemId) ?? ""}${params.delta}`)
  ctx.emit({ type: "item.delta", at: ctx.now(), itemId: params.itemId, append: params.delta })
}

/** 上下文占用取 last；total 是累计账单，只用于总消耗。 */
function onUsage(ctx: NotifyContext, params: WireTokenUsage): void {
  const usage = params.tokenUsage
  const used = usage?.last?.totalTokens
  if (usage === undefined || used === undefined) return
  ctx.emit({
    type: "usage.updated",
    at: ctx.now(),
    threadId: ctx.threadId,
    usage: {
      contextUsed: used,
      ...(usage.modelContextWindow === undefined
        ? {}
        : { contextWindow: usage.modelContextWindow }),
      ...(usage.total?.totalTokens === undefined ? {} : { totalTokens: usage.total.totalTokens }),
    },
  })
}

/** 轮次非正常收工时补齐在途工具终态；中断与失败不能混为一谈。 */
export function sweepInflight(ctx: NotifyContext, turnId: TurnId, status: TurnStatus): void {
  for (const [id, item] of ctx.inflight) {
    if (!ctx.materialized.has(id)) continue
    const streamed = ctx.streamed.get(id)
    const recovered = recoverStream(item, streamed)
    const omni = itemToOmni(recovered, { turnId, at: ctx.now() }, true)
    const closed = omni?.kind === "tool_call" ? closeTool(omni, status) : omni
    if (closed !== undefined) ctx.emit({ type: "item.updated", at: ctx.now(), item: closed })
  }
  ctx.inflight.clear()
  ctx.streamed.clear()
}

function closeTool(item: ToolCallItem, status: TurnStatus): ToolCallItem {
  if (status !== "completed") {
    return { ...item, status: status === "interrupted" ? "interrupted" : "failed" }
  }
  if (item.status !== "running" && item.status !== "pending") return item
  return { ...item, status: "failed", error: "Codex 在轮次结束前没有报告这次工具调用的结果。" }
}

function recoverStream(item: WireItem, streamed: string | undefined): WireItem {
  if (streamed === undefined) return item
  if (item.type === "agentMessage") return { ...item, text: streamed }
  if (item.type === "reasoning") return { ...item, summary: [streamed], content: [] }
  if (item.type === "commandExecution") return { ...item, aggregatedOutput: streamed }
  return item
}

function onTurnCompleted(ctx: NotifyContext, params: WireTurnLifecycle): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const message = params.turn.error?.message
  const status = turnStatus(params.turn.status)
  sweepInflight(ctx, turnId, status)
  ctx.settleTurn?.()
  ctx.emit({
    type: "turn.completed",
    at: ctx.now(),
    turnId,
    status,
    ...(message === undefined ? {} : { error: message }),
  })
}

/**
 * `willRetry` 是可恢复提示；同一轮原地更新一条，跨轮次不合并。
 * `additionalDetails` 是重连原因，必须保留。
 */
function onError(ctx: NotifyContext, params: WireError): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const at = ctx.now()
  const retry = params.willRetry === true
  const id = retry ? `err-retry-${turnId}` : `err-${String(at)}`
  const again = ctx.materialized.has(id)
  ctx.materialized.add(id)
  const detail = params.error?.additionalDetails
  ctx.emit({
    type: again ? "item.updated" : "item.started",
    at,
    item: {
      id,
      turnId,
      at,
      kind: "error",
      message: params.error?.message ?? "codex 报了一个没有描述的错误",
      fatal: !retry,
      ...(detail === undefined || detail === null || detail === "" ? {} : { detail }),
    },
  })
}

/**
 * 只收当前 codex thread 的通知，防止未来复用连接时串会话；可选 id 缺席则放行。
 */
function ours(ctx: NotifyContext, params: unknown): boolean {
  const from = (params as { threadId?: unknown } | undefined)?.threadId
  const ours = ctx.codexThread()
  if (typeof from === "string" && from !== "" && ours !== undefined && from !== ours) return false
  const nativeTurn = turnOf(params)
  const current = ctx.codexTurn?.()
  if (nativeTurn === undefined) return true
  if (ctx.settledTurns?.has(nativeTurn) === true) return false
  if (current !== undefined) return nativeTurn === current
  ctx.adoptCodexTurn?.(nativeTurn)
  return true
}

function turnOf(params: unknown): string | undefined {
  const raw = params as { turnId?: unknown; turn?: { id?: unknown } } | undefined
  const turn = raw?.turnId ?? raw?.turn?.id
  return typeof turn === "string" && turn !== "" ? turn : undefined
}

/** 方法表让新增通知保持平坦；线上参数先以 unknown 进入各自边界。 */
const HANDLERS: Readonly<Record<string, (ctx: NotifyContext, params: unknown) => void>> = {
  "item/started": (ctx, p) => {
    onItemStarted(ctx, p as WireItemLifecycle)
  },
  "item/completed": (ctx, p) => {
    onItemCompleted(ctx, p as WireItemLifecycle)
  },
  "item/agentMessage/delta": (ctx, p) => {
    onDelta(ctx, p as WireDelta)
  },
  "item/reasoning/summaryTextDelta": (ctx, p) => {
    onDelta(ctx, p as WireDelta)
  },
  "item/reasoning/textDelta": (ctx, p) => {
    onDelta(ctx, p as WireDelta)
  },
  "item/commandExecution/outputDelta": (ctx, p) => {
    onOutputDelta(ctx, p as WireDelta)
  },
  "thread/tokenUsage/updated": (ctx, p) => {
    onUsage(ctx, p as WireTokenUsage)
  },
  "turn/completed": (ctx, p) => {
    onTurnCompleted(ctx, p as WireTurnLifecycle)
  },
  "account/rateLimits/updated": (ctx, p) => {
    onLimits(ctx, p as { rateLimits?: WireRateLimits })
  },
  "mcpServer/startupStatus/updated": (ctx, p) => {
    onMcpStatus(ctx, p as WireMcpStatus)
  },
  error: (ctx, p) => {
    onError(ctx, p as WireError)
  },
  // **codex 唯一会主动说「我现在是什么档」的通知**，藏在实验面后面（见 `claims.ts`）
  "thread/settings/updated": (ctx, p) => {
    ctx.onSettings?.(readSettings(p))
  },
  // 整份计划快照。这条**没有**实验面，见 `plan.ts`
  "turn/plan/updated": (ctx, p) => {
    onPlanUpdate(ctx, p as WirePlanUpdate)
  },
}

/** 认不出的通知静默丢弃——协议一直在加新类型，多一种不该掀翻会话。 */
export function handleNotification(ctx: NotifyContext, method: string, params: unknown): void {
  if (!ours(ctx, params)) return
  HANDLERS[method]?.(ctx, params)
}

/** 两个窗口都没报告百分比时不发空额度。 */
function onLimits(ctx: NotifyContext, params: { rateLimits?: WireRateLimits }): void {
  emitLimits(ctx.emit, params.rateLimits)
}

/**
 * MCP 失败是能力降级而非引擎崩溃；只在状态翻面时提示。
 * 未知终态按失败处理，已确认的非失败态集中在 `MCP_FINE`。
 */
function onMcpStatus(ctx: NotifyContext, params: WireMcpStatus): void {
  const name = params.name ?? ""
  if (name === "") return
  const why = mcpFailure(params)
  const key = `${params.status ?? ""}:${why === undefined ? "ok" : "bad"}`
  // 翻面才出声，避免同一启动过程反复刷横幅。
  if (ctx.mcpSeen.get(name) === key) return
  ctx.mcpSeen.set(name, key)
  if (why === undefined) return
  ctx.emit({
    type: "engine.status",
    at: ctx.now(),
    threadId: ctx.threadId,
    status: "degraded",
    detail: `MCP 服务器「${name}」没起来，它提供的工具这一会话都用不了：${why}`,
  })
}

/** `cancelled` 是可被后续启动顶替的中间态；未知状态仍按失败暴露。 */
const MCP_FINE: ReadonlySet<string> = new Set(["starting", "ready", "cancelled"])

/** 起没起来；是的话给一句能读的原因，没失败给 undefined。 */
function mcpFailure(params: WireMcpStatus): string | undefined {
  const status = params.status ?? ""
  // `cancelled` 常常带着 `failureReason`，所以状态判断要在原因之前
  if (MCP_FINE.has(status)) return undefined
  const detail = params.failureReason ?? params.error
  if (detail !== undefined && detail !== null) {
    return typeof detail === "string" ? detail : JSON.stringify(detail)
  }
  return status
}
