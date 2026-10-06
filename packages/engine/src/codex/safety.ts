import type { Event, ItemId, NoticeLevel, TurnId, TurnStatus } from "@switchback/protocol"
import type { WireModelRerouted, WireModelVerification, WireSafetyBuffering, WireStrictReview } from "./wire.js"

export interface SafetyContext {
  emit: (event: Event) => void
  turnId: () => TurnId | undefined
  materialized: Set<ItemId>
  safetyActive?: Set<TurnId>
  now: () => number
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
    "这段会话多次触发了可能的网络安全风险标记，因此 Codex 已启用额外安全检查，响应可能更慢。如需进行经授权的安全工作，可申请 Trusted Access for Cyber：https://chatgpt.com/cyber",
    "warning",
  )
}

/** 引擎明确改道时同步留痕；实际选中模型由通知层回写，不让选择器继续显示旧值。 */
export function onModelRerouted(ctx: SafetyContext, params: WireModelRerouted): void {
  const turnId = ctx.turnId()
  const from = params.fromModel?.trim()
  const to = params.toModel?.trim()
  if (turnId === undefined || from === undefined || from === "" || to === undefined || to === "") return
  const reason = params.reason === "highRiskCyberActivity" ? "（触发网络安全风险检查）" : ""
  upsert(ctx, `codex-model-rerouted-${turnId}`, `Codex 已将模型从 ${from} 改为 ${to}${reason}。`, "warning")
}

export function onStrictReview(ctx: SafetyContext, params: WireStrictReview): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const stamp = Number.isFinite(params.startedAtMs) ? String(params.startedAtMs) : "unknown"
  upsert(
    ctx,
    `codex-strict-review-${turnId}-${stamp}`,
    "这个请求需要额外安全检查，部分工具调用可能会花更久。",
    "warning",
  )
}

export function onSafetyBuffering(ctx: SafetyContext, params: WireSafetyBuffering): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const id = `codex-safety-buffering-${turnId}`
  if (params.showBufferingUi === true) {
    ctx.safetyActive?.add(turnId)
    const faster = typeof params.fasterModel === "string" && params.fasterModel !== ""
      ? ` Codex 也提供更快模型「${params.fasterModel}」供重试；如需改用，请先停止当前轮。`
      : ""
    upsert(ctx, id, `Codex 正在对这个请求做额外安全检查，响应可能需要更久；无需操作，它会继续等待。${faster}`, "info")
    return
  }
  if (params.showBufferingUi === false && ctx.materialized.has(id)) {
    ctx.safetyActive?.delete(turnId)
    upsert(ctx, id, "Codex 已结束额外安全检查，正在继续响应。", "info")
  }
}

/** hide 通知迟到或缺席时，轮次终态仍必须把“正在检查”收掉。 */
export function finishSafetyBuffering(ctx: SafetyContext, status: TurnStatus): void {
  const turnId = ctx.turnId()
  if (turnId === undefined || ctx.safetyActive?.delete(turnId) !== true) return
  const message = status === "completed"
    ? "Codex 已结束额外安全检查。"
    : `Codex 的额外安全检查已随本轮${status === "interrupted" ? "中断" : "失败"}结束。`
  upsert(ctx, `codex-safety-buffering-${turnId}`, message, status === "failed" ? "warning" : "notice")
}
