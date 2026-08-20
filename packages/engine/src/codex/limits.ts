import type { Event, RateLimits, RateWindow } from "@omni/protocol"
import type { WireRateLimits, WireRateWindow } from "./wire.js"

/** Push and active account reads share one rate-limit translation. */
export function emitLimits(emit: (event: Event) => void, raw: WireRateLimits | undefined): void {
  const limits = toRateLimits(raw)
  if (limits === undefined) return
  emit({ type: "limits.updated", at: Date.now(), engine: "codex", limits })
}

function toRateLimits(raw: WireRateLimits | undefined): RateLimits | undefined {
  const primary = toWindow(raw?.primary)
  const secondary = toWindow(raw?.secondary)
  if (primary === undefined && secondary === undefined) return undefined
  return {
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
  }
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
