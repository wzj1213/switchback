import type { Event, ItemId, ToolCallItem } from "@switchback/protocol"
import { applyResult, type ToolResult } from "./translate.js"
import { localeOf } from "../locale.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { clip } from "../clip.js"

interface RawPermissionDenied {
  subtype?: unknown
  tool_use_id?: unknown
  message?: unknown
}

interface RawResult {
  permission_denials?: unknown
}

interface DenialContext {
  at: number
  emit: (event: Event) => void
  locale?: () => Locale
}

export interface DenialState {
  messages: Map<ItemId, string>
  settled: Map<ItemId, ToolCallItem>
}

export function createDenialState(): DenialState {
  return { messages: new Map(), settled: new Map() }
}

function idOf(value: unknown): ItemId | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function messageOf(value: unknown, locale: Locale): string | undefined {
  if (typeof value !== "string" || value === "") return undefined
  return clip(value, 4000, locale)
}

function deniedItem(item: ToolCallItem, message?: string): ToolCallItem {
  const error = item.error ?? message
  const detail = message === undefined
    ? item.detail
    : item.detail.kind === "shell" || item.detail.kind === "other"
      ? { ...item.detail, output: message }
      : item.detail
  return { ...item, status: "denied", detail, ...(error === undefined ? {} : { error }) }
}

/** 自动拒绝提示先把在途工具落成 denied；后续 tool_result 仍可补齐原始输出。 */
export function onPermissionDenied(
  raw: RawPermissionDenied,
  state: DenialState,
  tools: Map<ItemId, ToolCallItem>,
  ctx: DenialContext,
): void {
  if (raw.subtype !== "permission_denied") return
  const id = idOf(raw.tool_use_id)
  if (id === undefined) return
  const message = messageOf(raw.message, localeOf(ctx))
  if (message !== undefined) state.messages.set(id, message)
  const pending = tools.get(id) ?? state.settled.get(id)
  if (pending === undefined) return
  tools.delete(id)
  const denied = deniedItem(pending, message)
  state.settled.set(id, denied)
  ctx.emit({ type: "item.updated", at: ctx.at, item: denied })
}

/** 工具结果可能晚于自动拒绝提示；两条路径在这里合成同一个最终 item。 */
export function applyToolResult(
  result: ToolResult,
  state: DenialState,
  tools: Map<ItemId, ToolCallItem>,
  locale: Locale = DEFAULT_LOCALE,
): ToolCallItem | undefined {
  const pending = tools.get(result.toolUseId) ?? state.settled.get(result.toolUseId)
  if (pending === undefined) return undefined
  tools.delete(result.toolUseId)
  const applied = applyResult(pending, result, locale)
  const message = state.messages.get(result.toolUseId)
  const item = pending.status === "denied" || message !== undefined ? deniedItem(applied, message) : applied
  state.settled.set(result.toolUseId, item)
  return item
}

function denialIds(raw: RawResult): readonly ItemId[] {
  if (!Array.isArray(raw.permission_denials)) return []
  return raw.permission_denials.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const id = idOf((entry as { tool_use_id?: unknown }).tool_use_id)
    return id === undefined ? [] : [id]
  })
}

/** result.permission_denials 是权威记录，补上没有 advisory 的交互式宿主拒绝。 */
export function applyResultDenials(
  raw: RawResult,
  state: DenialState,
  tools: Map<ItemId, ToolCallItem>,
  ctx: DenialContext,
): void {
  for (const id of new Set(denialIds(raw))) {
    const item = state.settled.get(id) ?? tools.get(id)
    if (item === undefined) continue
    tools.delete(id)
    const denied = deniedItem(item, state.messages.get(id))
    state.settled.set(id, denied)
    if (item.status !== "denied") ctx.emit({ type: "item.updated", at: ctx.at, item: denied })
  }
}

export function clearDenials(state: DenialState): void {
  state.messages.clear()
  state.settled.clear()
}
