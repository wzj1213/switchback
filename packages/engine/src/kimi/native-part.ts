import type { TurnId } from "@omni/protocol"

/** 第一段保留既有稳定 id；续轮追加编号，避免覆盖前一段的计划与状态卡。 */
export function kimiNativePartId(prefix: string, turnId: TurnId, part: number): string {
  return part === 1 ? `${prefix}-${turnId}` : `${prefix}-${turnId}-${String(part)}`
}
