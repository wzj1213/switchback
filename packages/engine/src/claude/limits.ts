import type { RateLimits, RateWindow } from "@omni/protocol"

interface RawRateLimitInfo {
  status?: unknown
  resetsAt?: unknown
  rateLimitType?: unknown
  utilization?: unknown
}

interface WindowKind {
  slot: "primary" | "secondary"
  minutes: number
}

const WINDOW_KINDS: Readonly<Record<string, WindowKind>> = {
  five_hour: { slot: "secondary", minutes: 300 },
  seven_day: { slot: "primary", minutes: 10_080 },
  seven_day_opus: { slot: "primary", minutes: 10_080 },
  seven_day_sonnet: { slot: "primary", minutes: 10_080 },
  seven_day_overage_included: { slot: "primary", minutes: 10_080 },
}

const STATUSES = new Set(["allowed", "allowed_warning", "rejected"])

function recordOf(value: unknown): RawRateLimitInfo | undefined {
  return typeof value === "object" && value !== null ? (value as RawRateLimitInfo) : undefined
}

/** 生产帧与 SDK 上游都确认这里是 Unix 秒；非法值宁可不画重置时间。 */
function resetTime(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function windowOf(raw: RawRateLimitInfo, kind: WindowKind): RateWindow | undefined {
  const utilization = raw.utilization
  if (typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0) return undefined
  const resetsAt = resetTime(raw.resetsAt)
  return {
    // utilization 是 0–1 分数；协议统一用 0–100。
    usedPercent: utilization * 100,
    windowDurationMins: kind.minutes,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/**
 * SDK 只给当前「代表性」限额桶，不给完整快照；因此每帧最多翻一个窗口。
 * allowed 帧常常故意省略 utilization，此时 `{}` 用来清掉旧告警，绝不拿 0 冒充。
 */
export function toClaudeLimits(value: unknown): RateLimits | undefined {
  const raw = recordOf(value)
  if (raw === undefined || typeof raw.rateLimitType !== "string") return undefined
  const kind = WINDOW_KINDS[raw.rateLimitType]
  if (kind === undefined || typeof raw.status !== "string" || !STATUSES.has(raw.status)) return undefined
  const window = windowOf(raw, kind)
  if (window === undefined) return raw.status === "allowed" && raw.utilization === undefined ? {} : undefined
  return kind.slot === "primary" ? { primary: window } : { secondary: window }
}
