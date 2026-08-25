import type { Event, RateLimits, RateWindow } from "@omni/protocol"
import type { WireRateLimits, WireRateWindow } from "./wire.js"

type LimitFrame = "snapshot" | "patch"

/** Push 与主动读取共用形状转换，但只有完整快照能用空窗口清掉旧状态。 */
export function emitLimits(
  emit: (event: Event) => void,
  raw: WireRateLimits | undefined,
  frame: LimitFrame,
): void {
  const limits = toRateLimits(raw, frame)
  if (limits === undefined) return
  emit({ type: "limits.updated", at: Date.now(), engine: "codex", limits })
}

function toRateLimits(raw: WireRateLimits | undefined, frame: LimitFrame): RateLimits | undefined {
  if (raw === undefined) return undefined
  const primary = toWindow(raw?.primary)
  const secondary = toWindow(raw?.secondary)
  if (primary === undefined && secondary === undefined) {
    // 滚动通知里的 null 是「这帧没带」，完整读取里的 null 才是「当前确实没有」。
    return frame === "snapshot" && windowsAbsent(raw) ? {} : undefined
  }
  return {
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
  }
}

function windowsAbsent(raw: WireRateLimits): boolean {
  return (raw.primary === undefined || raw.primary === null) &&
    (raw.secondary === undefined || raw.secondary === null)
}

/** Accept ISO text or the confirmed Unix-second shape; do not guess milliseconds. */
function resetTime(raw: string | number | null | undefined): string | undefined {
  if (typeof raw === "string" && raw !== "") return raw
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined
  return new Date(raw * 1000).toISOString()
}

function toWindow(raw: WireRateWindow | null | undefined): RateWindow | undefined {
  if (raw === null || raw === undefined || typeof raw.usedPercent !== "number") return undefined
  const resetsAt = resetTime(raw.resetsAt)
  return {
    usedPercent: raw.usedPercent,
    ...(typeof raw.windowDurationMins === "number"
      ? { windowDurationMins: raw.windowDurationMins }
      : {}),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}
