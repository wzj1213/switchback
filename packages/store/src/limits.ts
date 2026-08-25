import type { RateLimits } from "@omni/protocol"

/**
 * 额度事件是逐窗口 patch；空对象是明确清空。
 *
 * Store 归约与 Host 重连快照必须共用这一条语义，否则现场正确、刷新后又退回单窗口。
 */
export function mergeRateLimits(before: RateLimits | undefined, patch: RateLimits): RateLimits {
  if (patch.primary === undefined && patch.secondary === undefined) return {}
  return { ...before, ...patch }
}
