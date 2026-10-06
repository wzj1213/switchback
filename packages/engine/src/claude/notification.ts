import type { EngineNotificationPriority, Event, ThreadId } from "@switchback/protocol"

interface RawNotification {
  key?: unknown
  text?: unknown
  priority?: unknown
  color?: unknown
  timeout_ms?: unknown
}

interface NotificationContext {
  threadId: ThreadId
  at: number
  emit: (event: Event) => void
}

const PRIORITIES: readonly EngineNotificationPriority[] = ["low", "medium", "high", "immediate"]

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function priorityOf(value: unknown): EngineNotificationPriority | undefined {
  return PRIORITIES.includes(value as EngineNotificationPriority)
    ? value as EngineNotificationPriority
    : undefined
}

function timeoutOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return value
}

/** Claude 的原生通知队列 → 宿主瞬时通知；不伪装成正文或能力故障。 */
export function emitNotification(msg: RawNotification, ctx: NotificationContext): void {
  const key = nonEmpty(msg.key)
  const message = nonEmpty(msg.text)
  const priority = priorityOf(msg.priority)
  if (key === undefined || message === undefined || priority === undefined) return
  const timeout = timeoutOf(msg.timeout_ms)
  const color = nonEmpty(msg.color)
  ctx.emit({
    type: "engine.notification",
    at: ctx.at,
    threadId: ctx.threadId,
    engine: "claude",
    key,
    message,
    priority,
    ...(color === undefined ? {} : { color }),
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
  })
}
