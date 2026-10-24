import type { Event, ItemId, NoticeLevel, TurnId, TurnStatus } from "@switchback/protocol"
import type { WireModelRerouted, WireModelVerification, WireSafetyBuffering, WireStrictReview } from "./wire.js"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CODEX_SAFETY } from "./safety.messages.js"

export interface SafetyContext {
  emit: (event: Event) => void
  turnId: () => TurnId | undefined
  materialized: Set<ItemId>
  safetyActive?: Set<TurnId>
  now: () => number
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

function upsert(
  ctx: SafetyContext,
  id: ItemId,
  message: string,
  level: NoticeLevel,
): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const at = ctx.now()
  const started = ctx.materialized.has(id)
  ctx.materialized.add(id)
  ctx.emit({
    type: started ? "item.updated" : "item.started",
    at,
    item: { id, turnId, at, kind: "notice", message, level },
  })
}

export function onModelVerification(ctx: SafetyContext, params: WireModelVerification): void {
  const turnId = ctx.turnId()
  if (turnId === undefined || !params.verifications?.includes("trustedAccessForCyber")) return
  upsert(
    ctx,
    `codex-cyber-verification-${turnId}`,
    CODEX_SAFETY[localeOf(ctx)].cyber,
    "warning",
  )
}

/** 引擎明确改道时同步留痕；实际选中模型由通知层回写，不让选择器继续显示旧值。 */
export function onModelRerouted(ctx: SafetyContext, params: WireModelRerouted): void {
  const turnId = ctx.turnId()
  const from = params.fromModel?.trim()
  const to = params.toModel?.trim()
  if (turnId === undefined || from === undefined || from === "" || to === undefined || to === "") return
  const message = CODEX_SAFETY[localeOf(ctx)].rerouted(from, to, params.reason === "highRiskCyberActivity")
  upsert(ctx, `codex-model-rerouted-${turnId}`, message, "warning")
}

export function onStrictReview(ctx: SafetyContext, params: WireStrictReview): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const stamp = Number.isFinite(params.startedAtMs) ? String(params.startedAtMs) : "unknown"
  upsert(
    ctx,
    `codex-strict-review-${turnId}-${stamp}`,
    CODEX_SAFETY[localeOf(ctx)].strict,
    "warning",
  )
}

export function onSafetyBuffering(ctx: SafetyContext, params: WireSafetyBuffering): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const id = `codex-safety-buffering-${turnId}`
  if (params.showBufferingUi === true) {
    ctx.safetyActive?.add(turnId)
    const faster = typeof params.fasterModel === "string" && params.fasterModel !== "" ? params.fasterModel : undefined
    upsert(ctx, id, CODEX_SAFETY[localeOf(ctx)].buffering(faster), "info")
    return
  }
  if (params.showBufferingUi === false && ctx.materialized.has(id)) {
    ctx.safetyActive?.delete(turnId)
    upsert(ctx, id, CODEX_SAFETY[localeOf(ctx)].resumed, "info")
  }
}

/** hide 通知迟到或缺席时，轮次终态仍必须把“正在检查”收掉。 */
export function finishSafetyBuffering(ctx: SafetyContext, status: TurnStatus): void {
  const turnId = ctx.turnId()
  if (turnId === undefined || ctx.safetyActive?.delete(turnId) !== true) return
  const m = CODEX_SAFETY[localeOf(ctx)]
  const message = status === "completed" ? m.finished : m.endedWith(status === "interrupted")
  upsert(ctx, `codex-safety-buffering-${turnId}`, message, status === "failed" ? "warning" : "notice")
}
