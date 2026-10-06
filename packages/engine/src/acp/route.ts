import type { StartRequest } from "../contract.js"
import { emitUsage, type UpdateContext } from "./update.js"
import type {
  AcpDriverConfig,
  ForeignActivity,
  ForeignActivityUpdate,
  ForeignActivityParser,
  ForeignNotice,
  ForeignNotification,
  ForeignTool,
} from "./caps.js"

/**
 * 通知进来之后**归谁**。
 *
 * 单独一个文件是因为它和驱动的其余部分回答的问题不同：那边是「收到这条要做什么」，
 * 这边是「这条是不是我的」。今天只有一条判据，但这正是它会长的方向——
 * 侧问、分叉、子 agent 都会让同一条 stdio 上跑多条会话。
 */

/**
 * 这条通知说的是**我这条会话**吗。
 *
 * ## 为什么必须判，即使今天判不出区别
 *
 * Switchback 现在一个引擎进程只开一条会话，所以同一条 stdio 上不该出现别的 sessionId。
 * 但「不该」不等于「不会」：**协议允许一条连接带多条会话**（`session/new` 可以调多次），
 * 而侧问、分叉、子 agent 这些都会往这个方向走。到那时串了**不会报错**——
 * 只会把别的会话的正文画进这一条，而那是最难查的一类。
 *
 * `AcpNotification.sessionId` 早就声明着，只是没人读。加这一句的成本是一次字符串比较。
 *
 * **报不上来就放行**：有的 agent 不带这个字段（协议上是可选的），
 * 一律拦掉的话那几家一条更新都收不到——那比串台严重得多。
 */
export function mine(from: string | undefined, ours: string | undefined): boolean {
  if (from === undefined || ours === undefined) return true
  return from === ours
}

/** 私有通知也沿用 sessionId；leader 包装会再套一层 params。 */
export function foreignSessionId(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined
  const raw = params as { sessionId?: unknown; params?: { sessionId?: unknown } }
  const value = raw.sessionId ?? raw.params?.sessionId
  return typeof value === "string" ? value : undefined
}

/**
 * 协议之外的私有通知怎么处理。
 *
 * ACP 只规定了 `session/update`，而各家都有自己的一摊：grok 的用量在
 * `_x.ai/session_notification` 里、换模型的回声也在那儿。**认哪个方法名、什么形状，
 * 由各家的模块答**（`AcpDriverConfig` 的 `contextUsed` / `modelChanged`）——
 * 这一层只负责把认出来的东西送到既有的那几条路上，不认识任何一家。
 */
export interface ForeignCtx {
  config: Pick<
    AcpDriverConfig,
    "contextUsed" | "cacheRead" | "outputTokens" | "modelChanged" | "notice" | "notification" | "toolItems"
  >
  activity: ForeignActivityParser | undefined
  state: {
    effort: string | undefined
    windowOf: Readonly<Record<string, number>>
    contextWindow: number | undefined
  }
  req: StartRequest
  update: () => UpdateContext
}

export function onForeign(ctx: ForeignCtx, method: string, params: unknown): void {
  const changed = ctx.config.modelChanged?.(method, params)
  if (changed !== undefined) adoptModelChange(ctx, changed)
  emitForeignContent(ctx, method, params)
  const used = ctx.config.contextUsed?.(method, params)
  if (used === undefined) return
  emitUsage(ctx.update(), used, ctx.state.contextWindow, {
    cacheRead: ctx.config.cacheRead?.(method, params),
    outputTokens: ctx.config.outputTokens?.(method, params),
  })
}

function emitForeignContent(ctx: ForeignCtx, method: string, params: unknown): void {
  const notice = ctx.config.notice?.(method, params)
  if (notice !== undefined) emitNotice(ctx.update(), notice)
  const notification = ctx.config.notification?.(method, params)
  if (notification !== undefined) emitNotification(ctx.update(), notification)
  const tools = ctx.config.toolItems?.(method, params)
  if (tools !== undefined) emitTools(ctx.update(), tools)
  const activity = ctx.activity?.(method, params)
  if (activity !== undefined) emitActivity(ctx.update(), activity)
}

function emitTools(ctx: UpdateContext, tools: readonly ForeignTool[]): void {
  for (const tool of tools) {
    const { promptId, ...item } = tool
    const current = ctx.turnId()
    const turnId = promptId === undefined || promptId === current ? current : undefined
    if (turnId === undefined) {
      if (item.error !== undefined && item.status !== "ok") {
        emitNotification(ctx, {
          key: ctx.newId("foreign-tool"), message: item.error, priority: "high",
        })
      }
      continue
    }
    const at = ctx.now()
    ctx.emit({
      type: "item.started",
      at,
      item: { id: ctx.newId("foreign-tool"), turnId, at, kind: "tool_call", ...item },
    })
  }
}

function emitNotification(ctx: UpdateContext, notification: ForeignNotification): void {
  ctx.emit({
    type: "engine.notification",
    at: ctx.now(),
    threadId: ctx.threadId,
    engine: ctx.engine,
    ...notification,
  })
}

function emitActivity(ctx: UpdateContext, update: ForeignActivityUpdate): void {
  if ("itemId" in update) {
    ctx.emit({
      type: "item.delta", at: ctx.now(), threadId: ctx.threadId,
      itemId: update.itemId, append: update.append,
    })
    return
  }
  const activity: ForeignActivity = update
  const at = ctx.now()
  ctx.emit({
    type: "lane.updated",
    at,
    threadId: ctx.threadId,
    lane: { ...activity, threadId: ctx.threadId, kind: "activity", at },
  })
}

function emitNotice(ctx: UpdateContext, notice: ForeignNotice): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const at = ctx.now()
  ctx.emit({
    type: "item.started",
    at,
    item: { id: ctx.newId("notice"), turnId, at, kind: "notice", ...notice },
  })
}

/** 引擎自己换了模型 / 强度：落到状态上，并沿两条既有的路报上去。 */
function adoptModelChange(ctx: ForeignCtx, changed: { model?: string; effort?: string }): void {
  if (changed.effort !== undefined) ctx.state.effort = changed.effort
  if (changed.model !== undefined) ctx.state.contextWindow = ctx.state.windowOf[changed.model]
  ctx.req.onModel?.(changed.model, changed.effort)
  if (changed.model !== undefined) ctx.req.onEngineState?.({ modelId: changed.model })
}
