/**
 * 「压缩上下文」和「往正在跑的那一轮里插一句」怎么落到 ACP 引擎上。
 *
 * ## 为什么是新文件
 *
 * `acp/driver.ts` 实测 294/300——方案里早写着「往后动它的批次要把新增代码放进新文件」。
 * 但边界本来也在这儿：这两件事和 `mode.ts`（信任档怎么落）、`model.ts`（模型强度怎么落）
 * 是同一类，都是「界面点了一下 → 发哪一发 RPC → 发不出去怎么向用户交代」。
 *
 * ## 这两位为什么以前一律报 false
 *
 * 上上版的注释写着「ACP 没有压缩上下文的方法（实测 kimi → Method not found）」——
 * **一家的实测被当成了全家族的结论**。上一版改对了描述，但仍然报 false，
 * 理由是「驱动一个都没实现，翻成 true 就是给一个点了没反应的入口」。那是对的，
 * 这个文件就是来还这笔账的。
 *
 * ## 谁支持，实测（2026-08-19，三家各起一次真进程）
 *
 * | 引擎 | `session/compact` | `session/steer` |
 * |---|---|---|
 * | kimi 0.37.2 | `-32601 Method not found` | `-32601 Method not found` |
 * | grok 1.0.5 | `-32601 Method not found` | `-32601 Method not found` |
 * | zcode-acp-server 0.5.1 | **成功**，回一份 snapshot | 方法在（空转会话上报 `-32603`，不是「方法不存在」） |
 *
 * 所以**不能从协议推**，只能各家自己说——和 `modeReadback` 同一条路子
 *（`AcpDriverConfig`）。kimi 有它自己的 `/compact` 斜杠命令，走
 * `available_commands_update` 那条路，omni 早就把它送到界面了：
 * **那不需要这一位为 true**，因为那颗入口不是 omni 给的。
 */

import type { Event, TurnId } from "@omni/protocol"
import { sweep, type UpdateContext, type UpdateState } from "./update.js"
import { stopStatus } from "./translate.js"
import type { AcpPromptResult } from "./wire.js"

/**
 * 形状**刻意和 `knobs()` 对齐**（`TrustCtx` / `ModelCtx` 同一个来源），
 * 于是驱动那边一个 `{...this.knobs(), can}` 就够——不用再养一个 ctx 构造函数。
 * 那不只是省几行：多一个构造函数就多一处会和其余几处漂移的地方。
 */
export interface TurnCtx {
  id: string
  call: (method: string, params: unknown) => Promise<unknown>
  state: { acpSession: string | undefined }
  /** 这家认不认这两个方法。由 `AcpDriverConfig` 注入，见文件头那张表。 */
  can: { compact?: boolean; steer?: boolean }
}

/**
 * 发不出去时说人话。
 *
 * `-32601 Method not found` 对用户毫无意义——他要知道的是「这家做不到，不是坏了」。
 * 而这两件事的入口都是 omni 自己给的按钮，所以**说错一次就是一次「点了没反应」**。
 */
function refuse(what: string, id: string): Error {
  return new Error(`${id} 不支持${what}。这不是故障——它的适配器没提供这个方法。`)
}

/**
 * 压缩上下文。**只有引擎自己能做**——它才知道哪些能扔、总结成什么样喂回去不失真。
 *
 * 回包里带一份 snapshot（实测 zcode），但 omni 不解析它：压缩之后的历史以引擎为准，
 * omni 这边照常靠后续的 `session/update` 收正文。**拿回包去重建 transcript
 * 是替引擎记账**，撞总纲第三条。
 */
export async function compactSession(ctx: TurnCtx): Promise<void> {
  const sessionId = ctx.state.acpSession
  if (sessionId === undefined) throw new Error("会话还没建立，压缩不了")
  if (ctx.can.compact !== true) throw refuse("压缩上下文", ctx.id)
  await ctx.call("session/compact", { sessionId })
}

/** ACP 扩展以成功回包作为终点；不像 Codex/Kimi 另有异步生命周期。 */
export function reportCompaction(
  emit: (event: Event) => void,
  turnId: TurnId,
  at: number,
): void {
  emit({
    type: "item.started",
    at,
    item: {
      id: `acp-compaction-${turnId}`,
      turnId,
      at,
      kind: "notice",
      message: "上下文已压缩。",
      level: "info",
    },
  })
  emit({ type: "turn.completed", at, turnId, status: "completed" })
}

export async function compactAndReport(
  ctx: TurnCtx & { emit: (event: Event) => void },
  turnId: TurnId,
): Promise<void> {
  await compactSession(ctx)
  reportCompaction(ctx.emit, turnId, Date.now())
}

/**
 * 把话递进正在跑的那一轮。
 *
 * **字段名是 `content`，不是 `text` 也不是 `prompt`。** 这是读 zcode-acp-server 的
 * `handlers/extensions.js` 抄下来的（`String(params.content ?? "")`，空的直接抛
 * `steer requires content`）——第一次探测发 `text` 得到的是 `-32603 Internal error`，
 * 那看起来像「方法坏了」，其实是参数名不对。**同一个错误码兼着两种意思**，
 * 所以这里把名字钉死在注释里。
 *
 * 附件不带：ACP 这条私有扩展没有附件位，而把附件路径拼进正文是 omni 替引擎编格式。
 * 有附件时退回排队（宿主那边 `steerInto` 返回 false 就是这个意思）。
 */
export async function steerSession(ctx: TurnCtx, text: string, attachments?: readonly string[]): Promise<void> {
  const sessionId = ctx.state.acpSession
  if (sessionId === undefined) throw new Error("会话还没建立，插不进去")
  if (ctx.can.steer !== true) throw refuse("中途插话", ctx.id)
  if (attachments !== undefined && attachments.length > 0) throw refuse("带附件插话", ctx.id)
  await ctx.call("session/steer", { sessionId, content: text })
}


/**
 * 一轮**怎么落终态**，以及怎么把它停下。
 *
 * 和上面两个函数放在一起，是因为它们回答的是同一个问题：**对正在跑的这一轮做点什么**。
 * 从 `driver.ts` 搬出来的直接理由是行数闸门（加了 compact/steer 之后 301/300），
 * 但边界本来就在这儿——那边剩下的是「收发怎么接线」。
 */
export interface EndCtx {
  state: { turn: TurnId | undefined; acpSession: string | undefined }
  update: () => UpdateContext
  updates: UpdateState
  emit: (event: Event) => void
  notify: (method: string, params: unknown) => void
}

/**
 * 正常收工。`state.turn !== turnId` 时什么都不做——**幂等**：
 * 中断那条路和 `session/prompt` 的回包会一前一后都到，发两条终态事件的话
 * journal 里就多一行。
 */
export function finishTurn(ctx: EndCtx, turnId: TurnId, reason: AcpPromptResult["stopReason"]): void {
  if (ctx.state.turn !== turnId) return
  const { status, error } = stopStatus(reason)
  sweep(ctx.update(), ctx.updates, status === "interrupted" ? "interrupted" : "failed")
  ctx.state.turn = undefined
  ctx.emit({ type: "turn.completed", at: Date.now(), turnId, status, ...(error === undefined ? {} : { error }) })
}

/**
 * 一轮直接报错。实测过：适配器版本比配置的模型旧时，`session/prompt`
 * 回的是 JSON-RPC error 而不是 `stopReason`，两条路都要走通，
 * 否则那一轮会永远停在「进行中」。
 */
export function failTurn(ctx: EndCtx, turnId: TurnId, message: string): void {
  if (ctx.state.turn !== turnId) return
  sweep(ctx.update(), ctx.updates, "failed")
  ctx.state.turn = undefined
  ctx.emit({ type: "turn.completed", at: Date.now(), turnId, status: "failed", error: message })
}

/**
 * 中断。`session/cancel` 是**通知不是请求**——发完不等回应，
 * 在途的 `session/prompt` 会以 `stopReason: "cancelled"` 收尾。
 * 当成请求发会永远等不到应答。
 */
export function cancelTurn(ctx: EndCtx): void {
  const sessionId = ctx.state.acpSession
  if (sessionId === undefined) return
  ctx.notify("session/cancel", { sessionId })
}
