import type { ErrorItem, Event, TurnId } from "@switchback/protocol"
import { localeOf } from "../locale.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_RETRY } from "./retry.messages.js"

interface RawRetry {
  attempt?: unknown
  max_retries?: unknown
  retry_delay_ms?: unknown
  error_status?: unknown
  error?: unknown
}

interface RetryContext {
  turnId: TurnId
  at: number
  emit: (event: Event) => void
  locale?: () => Locale
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined

/** SDK 明确报出「可恢复且会再试」；这里只排版原始计数、延迟与错误类别，不猜原因。 */
export function retryItem(raw: RawRetry, turnId: TurnId, at: number, locale: Locale = DEFAULT_LOCALE): ErrorItem | undefined {
  const attempt = count(raw.attempt)
  const maximum = count(raw.max_retries)
  const delay = count(raw.retry_delay_ms)
  if (attempt === undefined || maximum === undefined || delay === undefined) return undefined
  if (typeof raw.error !== "string" || raw.error.trim() === "") return undefined
  if (raw.error_status !== null && typeof raw.error_status !== "number") return undefined
  const status = typeof raw.error_status === "number" ? ` · HTTP ${String(raw.error_status)}` : ""
  return {
    id: `${turnId}:claude-api-retry`,
    turnId,
    at,
    kind: "error",
    message: CLAUDE_RETRY[locale].retrying(attempt, maximum, delay),
    detail: `${raw.error}${status}`,
    fatal: false,
  }
}

/** 同一轮的多次 API 重试只占一行，与 Codex / Kimi 的现有重试语义一致。 */
export function emitRetry(raw: RawRetry, previous: ErrorItem | undefined, ctx: RetryContext): ErrorItem | undefined {
  const item = retryItem(raw, ctx.turnId, ctx.at, localeOf(ctx))
  if (item === undefined) return undefined
  ctx.emit({ type: previous === undefined ? "item.started" : "item.updated", at: ctx.at, item })
  return item
}
