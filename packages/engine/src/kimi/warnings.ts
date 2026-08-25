import type { EngineNotificationPriority, Event, ThreadId } from "@omni/protocol"
import type { KimiPayload, KimiSessionWarning } from "./wire.js"

interface WarningContext {
  threadId: ThreadId
  at: number
  emit: (event: Event) => void
}

const PRIORITY: Readonly<Record<KimiSessionWarning["severity"], EngineNotificationPriority>> = {
  info: "low",
  warning: "medium",
  error: "high",
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function severity(value: unknown): KimiSessionWarning["severity"] | undefined {
  if (value === "info" || value === "warning" || value === "error") return value
  return undefined
}

function warningOf(raw: unknown): KimiSessionWarning | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const message = str(record["message"])
  const level = severity(record["severity"])
  if (message === undefined || level === undefined) return undefined
  return { code: str(record["code"]) ?? "warning", message, severity: level }
}

function emitWarning(warning: KimiSessionWarning, ctx: WarningContext): void {
  ctx.emit({
    type: "engine.notification",
    at: ctx.at,
    threadId: ctx.threadId,
    engine: "kimi",
    key: `session-warning:${warning.code}`,
    message: warning.message,
    priority: PRIORITY[warning.severity],
  })
}

export function emitKimiSessionWarnings(raw: unknown, ctx: WarningContext): void {
  if (!Array.isArray(raw)) return
  for (const entry of raw) {
    const warning = warningOf(entry)
    if (warning !== undefined) emitWarning(warning, ctx)
  }
}

export function emitKimiLiveWarning(payload: KimiPayload, ctx: WarningContext): void {
  const message = str(payload.message)
  if (message === undefined) return
  emitWarning({ code: str(payload.code) ?? "warning", message, severity: "warning" }, ctx)
}
