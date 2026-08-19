import type { Event, ItemId, RateLimits, RateWindow, ThreadId, ToolStatus, TurnId, TurnStatus } from "@omni/protocol"
import { isStreamingText, itemToOmni, textOf, turnStatus } from "./translate.js"
import { readSettings, type CodexSettings } from "./settings.js"
import { onPlanUpdate } from "./plan.js"
import type { WireDelta, WireError, WireItem, WireItemLifecycle, WireMcpStatus, WirePlanUpdate, WireRateLimits, WireRateWindow, WireTokenUsage, WireTurnLifecycle } from "./wire.js"

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
  /**
   * 在途 item。审批请求只带 itemId 回来，要靠这张表说清楚在批准什么——
   * 见 `approve.ts` 开头。
   */
  inflight: Map<string, WireItem>
  /** 已经发过 `item.started` 的 id。文本流式 item 有内容才落地，见下。 */
  materialized: Set<ItemId>
  /**
   * MCP 服务器最近一次报的状态。**只在翻面时出声**——
   * 一次启动实测报 17 条通知，每条都弹一个横幅的话，那就不是提示是刷屏。
   */
  mcpSeen: Map<string, string>
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
export function sweepInflight(ctx: NotifyContext, turnId: TurnId, status: TurnStatus): void {
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
/**
 * 这条通知说的是**我这条会话**吗。
 *
 * ## 为什么必须判，即使今天判不出区别
 *
 * omni 现在一个 codex 进程只开一条 thread，所以同一条 stdio 上不该出现别的 threadId。
 * 但「不该」不等于「不会」：app-server 一条连接**本来就能带多条 thread**，
 * 而分叉（`thread/fork`）、子 agent、后台轮次都会往这个方向走。
 * 到那时串了**不会报错**——只会把别的会话的正文画进这一条。
 *
 * 线上的字段早就在（`WireItemLifecycle.threadId` 等），只是没人读。
 *
 * **报不上来就放行**：有几条通知的 `threadId` 是可选的（`WireTokenUsage` / `WireError`），
 * 一律拦掉的话用量和错误就都收不到了。和 `acp/route.ts` 的 `mine` 同一条取舍。
 */
function ours(ctx: NotifyContext, params: unknown): boolean {
  const from = (params as { threadId?: unknown } | undefined)?.threadId
  if (typeof from !== "string" || from === "") return true
  const ours = ctx.codexThread()
  return ours === undefined || from === ours
}

/**
 * 方法名 → 处理函数。
 *
 * 用表不用 `switch` 的理由和 `acp/update.ts` 那边一样：`switch` 版加上会话归属那一判
 * 之后实测圈复杂度 **13**，而闸门是 12——**再加一种通知就会红**，而 app-server
 * 一直在加新的。表是加一行就只是加一行。
 *
 * 参数一律 `unknown` 进、各自 as 成自己那个形状：线上的东西本来就不可信，
 * 在表里统一断言反而会把「这条其实是另一种形状」藏起来。
 */
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

/**
 * 账号额度。**只在两个窗口至少有一个报得出百分比时才发**——
 * 这台机器上实测 `primary`/`secondary` 都可能是 null（免费额度那种账号），
 * 那时发一条空的出去只会让界面画一根没有含义的条。
 */
function onLimits(ctx: NotifyContext, params: { rateLimits?: WireRateLimits }): void {
  emitLimits(ctx.emit, params.rateLimits)
}

/**
 * 额度发出去。**推送和主动读走同一条路**——两处各写一份翻译的话，
 * 「握手时读到的」和「跑完一轮推来的」会长得不一样，而它们说的是同一件事。
 */
export function emitLimits(emit: NotifyContext["emit"], raw: WireRateLimits | undefined): void {
  const limits = toRateLimits(raw)
  if (limits === undefined) return
  emit({ type: "limits.updated", at: Date.now(), engine: "codex", limits })
}

/**
 * MCP 服务器起没起来。
 *
 * ## 为什么这件事必须说出来
 *
 * MCP 服务器起不来的时候，codex **照跑不误**——只是那台服务器的工具全没了。
 * 实测这台机器上一个 `codex_apps` 就带 45 个工具。少了它，agent 的表现是
 * 「今天做得不太行」「说它做不到」，而你完全不知道为什么。
 * **静默的能力损失是最难查的一类故障**，因为没有任何东西出错。
 *
 * 报 `degraded` 不报 `crashed`：引擎好好的，撒谎会把排查引到错的方向。
 *
 * ## 失败态的字符串没有实测到，所以不硬编码
 *
 * 这台机器上 5 个服务器全起来了，只观察到 `starting` / `ready`。
 * 于是判据反过来写：**不是这两个就算失败**，另外只要带了 `error` 或
 * `failureReason` 也算——猜一个 `"failed"` 字面量，猜错了就是永远不报警。
 */
function onMcpStatus(ctx: NotifyContext, params: WireMcpStatus): void {
  const name = params.name ?? ""
  if (name === "") return
  const why = mcpFailure(params)
  const key = `${params.status ?? ""}:${why === undefined ? "ok" : "bad"}`
  // 翻面才出声：一次启动实测 17 条通知，条条弹横幅就不是提示是刷屏
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

/**
 * 不算失败的状态。
 *
 * `starting` / `ready` 是显然的。**`cancelled` 是拿误报换来的**：
 * 判据本来写成「不是 starting/ready 就算失败」（失败态的字面量当时没实测到），
 * 结果一次启动里五台服务器同时报 `cancelled`，界面上刷了五条横幅——
 * 而那几台后来都好好的（`codex_apps` 有 45 个工具）。
 * 所以 `cancelled` 是启动被取消/被顶替的中间态，不是起不来。
 *
 * 保留「没见过的一律当失败」这条：**猜一个 `"failed"` 字面量，猜错了就是永远不报警**，
 * 而多报一次的代价只是一条横幅——但见过的误报要一条条摘掉，不能装看不见。
 */
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

function toRateLimits(raw: WireRateLimits | undefined): RateLimits | undefined {
  const primary = toWindow(raw?.primary)
  const secondary = toWindow(raw?.secondary)
  if (primary === undefined && secondary === undefined) return undefined
  return { ...(primary === undefined ? {} : { primary }), ...(secondary === undefined ? {} : { secondary }) }
}

/**
 * 重置时刻 → ISO 字符串（协议里就是这个形状）。
 *
 * codex 给的是 **Unix 秒**。两条都认：字符串原样过（万一哪天它改了），
 * 数字按秒换算。**不认毫秒**——1787196555 当毫秒解出来是 1970 年，
 * 一个明显错误的时间比没有时间糟得多，所以宁可只支持实测到的那一种。
 */
function resetTime(raw: string | number | null | undefined): string | undefined {
  if (typeof raw === "string" && raw !== "") return raw
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined
  return new Date(raw * 1000).toISOString()
}

function toWindow(raw: WireRateWindow | null | undefined): RateWindow | undefined {
  if (raw === null || raw === undefined || typeof raw.usedPercent !== "number") return undefined
  return {
    usedPercent: raw.usedPercent,
    ...(typeof raw.windowDurationMins === "number" ? { windowDurationMins: raw.windowDurationMins } : {}),
    ...(resetTime(raw.resetsAt) === undefined ? {} : { resetsAt: resetTime(raw.resetsAt) }),
  }
}
