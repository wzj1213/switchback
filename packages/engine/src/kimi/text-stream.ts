import type { ItemId, TurnId } from "@omni/protocol"

export interface KimiTextState {
  id: ItemId
  kind: "agent_message" | "reasoning"
  text: string
  /** Kimi 的 offset 与快照文本都以当前 step 为边界；item 分段不重置它。 */
  total: string
  started: boolean
  part: number
}

export interface KimiDeltaPlacement {
  append?: string
  gap?: { expected: number; got: number }
}

export function kimiTextState(
  turnId: TurnId,
  kind: KimiTextState["kind"],
  part = 1,
  total = "",
): KimiTextState {
  const prefix = kind === "agent_message" ? "kimi-answer" : "kimi-thinking"
  const id = part === 1 ? `${prefix}-${turnId}` : `${prefix}-${turnId}-${String(part)}`
  return { id, kind, text: "", total, started: false, part }
}

/** 与 Kimi Web 的公开 offset 放置规则一致：去重、补重叠后缀，分叉或缺口要求重同步。 */
export function alignKimiDelta(
  local: string,
  offset: number | undefined,
  chunk: string,
): KimiDeltaPlacement {
  if (chunk === "") return {}
  if (offset === undefined) return { append: chunk }
  if (offset > local.length) return { gap: { expected: local.length, got: offset } }
  if (local.slice(offset, offset + chunk.length) === chunk) return {}
  const overlap = local.length - offset
  if (local.slice(offset) !== chunk.slice(0, overlap)) {
    return { gap: { expected: local.length, got: offset } }
  }
  const append = overlap > 0 ? chunk.slice(overlap) : chunk
  return append === "" ? {} : { append }
}
