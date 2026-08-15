import type { Event, ItemId, ThreadId, ToolStatus, TurnId, TurnStatus } from "@omni/protocol"
import { isStreamingText, itemToOmni, textOf, turnStatus } from "./translate.js"
import type {
  WireDelta,
  WireError,
  WireItem,
  WireItemLifecycle,
  WireTokenUsage,
  WireTurnLifecycle,
} from "./wire.js"

/**
 * codex 通知 → omni 事件。
 *
 * 有意做成模块级函数 + 显式 ctx，而不是 class 的私有方法：这样每一支都能单独测，
 * 不用先造一个会话。
 */
export interface NotifyContext {
  threadId: ThreadId
  emit: (event: Event) => void
  /** 宿主铸造的当前轮次 id。codex 自己的 turnId 只用来判断是不是当前轮。 */
  turnId: () => TurnId | undefined
  /**
   * 在途 item。审批请求只带 itemId 回来，要靠这张表说清楚在批准什么——
   * 见 `approve.ts` 开头。
   */
  inflight: Map<string, WireItem>
  /** 已经发过 `item.started` 的 id。文本流式 item 有内容才落地，见下。 */
  materialized: Set<ItemId>
  now: () => number
}

/**
 * 文本流式 item 的**延迟落地**。
 *
 * codex 的 reasoning item 经常从头到尾是空的（没开推理摘要时），agentMessage 也可能
 * 起手就是空壳。在 `item/started` 时就发出去，界面上会多出一条看不见的 item——
 * 它不显示内容，却会把连续的工具调用分组打断。所以等到**真有内容**再落地：
 * 第一条 delta，或者一条非空的 completed。
 */
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
  if (isStreamingText(params.item.type)) return
  const omni = itemToOmni(params.item, { turnId, at: ctx.now() }, false)
  if (omni === undefined) return
  ctx.materialized.add(omni.id)
  ctx.emit({ type: "item.started", at: ctx.now(), item: omni })
}

function onItemCompleted(ctx: NotifyContext, params: WireItemLifecycle): void {
  const turnId = ctx.turnId()
  ctx.inflight.delete(params.item.id)
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
  ctx.emit({ type: "item.delta", at: ctx.now(), itemId: params.itemId, append: params.delta })
}

/**
 * 命令的输出增量。
 *
 * 与文本流式 item 不同，工具 item 在 `item/started` 时就已经落地了，
 * 这里不需要 materialize，直接追加即可。
 *
 * 实测确认过一件要紧的事：这些 delta 拼起来**恰好等于**收工时那条
 * `aggregatedOutput`。所以收工时整条替换不会把输出重复一遍——
 * 如果哪天 codex 改成「delta 是增量、aggregated 是全量之外的东西」，
 * 这里就会出现双份输出，那是第一个要查的地方。
 */
function onOutputDelta(ctx: NotifyContext, params: WireDelta): void {
  if (ctx.turnId() === undefined || !ctx.materialized.has(params.itemId)) return
  ctx.emit({ type: "item.delta", at: ctx.now(), itemId: params.itemId, append: params.delta })
}

/**
 * 用量。取 `last.totalTokens` 而不是 `total.totalTokens`——
 * 后者是**累计账单**，会一路涨到远超窗口大小；前者才是「这次请求占了多少上下文」，
 * 也就是离压缩那条线还有多远。拿错了这个数，进度条会在第三轮就爆表。
 */
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
      ...(usage.modelContextWindow === undefined ? {} : { contextWindow: usage.modelContextWindow }),
      ...(usage.total?.totalTokens === undefined ? {} : { totalTokens: usage.total.totalTokens }),
    },
  })
}

/**
 * 轮次收工时清扫还挂着的工具调用。
 *
 * **中断时 codex 不会给在途的 `commandExecution` 补一条 `item/completed`。**
 * 不扫的话那条工具行永远停在 `running`——界面上是一个转到天荒地老的状态，
 * 而实际上进程早就被杀了。实测中断一条 40 秒的循环命令时现形。
 *
 * 收尾状态跟着轮次走：被中断就是 `interrupted`，失败就是 `failed`。
 * 一律写成 `failed` 会让「你自己按了停止」看起来像「它出错了」。
 */
function sweepInflight(ctx: NotifyContext, turnId: TurnId, status: TurnStatus): void {
  if (status === "completed") return
  const ending: ToolStatus = status === "interrupted" ? "interrupted" : "failed"
  for (const [id, item] of ctx.inflight) {
    if (!ctx.materialized.has(id)) continue
    const omni = itemToOmni(item, { turnId, at: ctx.now() }, true)
    if (omni?.kind !== "tool_call") continue
    ctx.emit({ type: "item.updated", at: ctx.now(), item: { ...omni, status: ending } })
  }
  ctx.inflight.clear()
}

function onTurnCompleted(ctx: NotifyContext, params: WireTurnLifecycle): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const message = params.turn.error?.message
  const status = turnStatus(params.turn.status)
  sweepInflight(ctx, turnId, status)
  ctx.emit({
    type: "turn.completed",
    at: ctx.now(),
    turnId,
    status,
    ...(message === undefined ? {} : { error: message }),
  })
}

/**
 * `willRetry` 为真时不算终态——codex 会自己重试，这时候在界面上画一条
 * 红色的失败会误导人。降成一条非致命提示。
 */
function onError(ctx: NotifyContext, params: WireError): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const at = ctx.now()
  ctx.emit({
    type: "item.started",
    at,
    item: {
      id: `err-${String(at)}`,
      turnId,
      at,
      kind: "error",
      message: params.error?.message ?? "codex 报了一个没有描述的错误",
      fatal: params.willRetry !== true,
    },
  })
}

/** 认不出的通知静默丢弃——codex 有 74 种通知，我们只消费其中一小撮。 */
export function handleNotification(ctx: NotifyContext, method: string, params: unknown): void {
  switch (method) {
    case "item/started":
      return onItemStarted(ctx, params as WireItemLifecycle)
    case "item/completed":
      return onItemCompleted(ctx, params as WireItemLifecycle)
    case "item/agentMessage/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return onDelta(ctx, params as WireDelta)
    case "item/commandExecution/outputDelta":
      return onOutputDelta(ctx, params as WireDelta)
    case "thread/tokenUsage/updated":
      return onUsage(ctx, params as WireTokenUsage)
    case "turn/completed":
      return onTurnCompleted(ctx, params as WireTurnLifecycle)
    case "error":
      return onError(ctx, params as WireError)
    default:
      return
  }
}
