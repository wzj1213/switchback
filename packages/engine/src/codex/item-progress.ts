import type { Event, ItemId, TurnId } from "@omni/protocol"
import { itemToOmni } from "./translate.js"
import type { WireFilePatch, WireItem, WireMcpProgress } from "./wire.js"

interface ProgressContext {
  inflight: Map<string, WireItem>
  materialized: Set<ItemId>
  turnId: () => TurnId | undefined
  emit: (event: Event) => void
  now: () => number
}

const PROGRESS_MAX = 20

function update(ctx: ProgressContext, item: WireItem): void {
  ctx.inflight.set(item.id, item)
  const turnId = ctx.turnId()
  if (turnId === undefined || !ctx.materialized.has(item.id)) return
  const at = ctx.now()
  const mapped = itemToOmni(item, { turnId, at }, false)
  if (mapped !== undefined) ctx.emit({ type: "item.updated", at, item: mapped })
}

/** 文件补丁是整份快照；原地替换，界面才能在工具收工前预览真实变更。 */
export function onFilePatch(ctx: ProgressContext, params: WireFilePatch): void {
  const item = ctx.inflight.get(params.itemId)
  if (item?.type !== "fileChange" || params.changes === undefined) return
  update(ctx, { ...item, changes: params.changes })
}

/** MCP 进度只留最近 20 条，避免长任务把会话内存无限撑大。 */
export function onMcpProgress(ctx: ProgressContext, params: WireMcpProgress): void {
  const item = ctx.inflight.get(params.itemId)
  const message = params.message?.trim()
  if (item?.type !== "mcpToolCall" || message === undefined || message === "") return
  const progress = [...(item.progress ?? []), message].slice(-PROGRESS_MAX)
  update(ctx, { ...item, progress })
}

/** completed 快照不带临时进度时保留它；最终 result 到了则以 result 为准。 */
export function retainProgress(completed: WireItem, active: WireItem | undefined): WireItem {
  if (completed.type !== "mcpToolCall" || (completed.result !== undefined && completed.result !== null)) return completed
  return active?.progress === undefined ? completed : { ...completed, progress: active.progress }
}
