import type { Event, ThreadId } from "@switchback/protocol"
import { mergeRateLimits } from "@switchback/store"

interface LiveStateCtx {
  liveState: Map<string, Event>
  live: ReadonlyMap<ThreadId, unknown>
}

/**
 * 不落盘、但描述现状的事件。窗口重建必须补最后一帧，否则它们会落进
 * “journal 没有、旧 seq 又被丢弃”的缝里。一次变化（如 thread.removed）不在这里。
 */
const LIVE_STATE: ReadonlySet<string> = new Set([
  "limits.updated", "commands.updated", "engine.history", "account.updated",
  "thinking.updated", "tasks.updated",
])

function liveKey(event: Event): string | undefined {
  if (event.type === "limits.updated") return `limits:${event.engine}`
  if (event.type === "commands.updated") return `commands:${event.threadId}\u0000${event.engine}`
  if (event.type === "engine.history") return `history:${event.engine}`
  if (event.type === "account.updated") return `account:${event.engine}`
  if (event.type === "thinking.updated") return `thinking:${event.threadId}`
  if (event.type === "tasks.updated") return `tasks:${event.threadId}`
  return undefined
}

/** 重连快照里的额度要保留逐窗口合并语义，不能只记最后一帧稀疏 patch。 */
function liveEvent(before: Event | undefined, event: Event): Event {
  if (event.type !== "limits.updated" || before?.type !== "limits.updated") return event
  return { ...event, limits: mergeRateLimits(before.limits, event.limits) }
}

function clears(event: Event): boolean {
  if (event.type === "thinking.updated") return event.estimatedTokens === undefined
  return event.type === "tasks.updated" && event.tasks.length === 0
}

export function rememberLiveState(ctx: LiveStateCtx, event: Event): void {
  const key = LIVE_STATE.has(event.type) ? liveKey(event) : undefined
  if (key === undefined) return
  if (clears(event)) ctx.liveState.delete(key)
  else ctx.liveState.set(key, liveEvent(ctx.liveState.get(key), event))
}

export function clearTurnLiveState(ctx: LiveStateCtx, threadId: ThreadId): void {
  ctx.liveState.delete(`thinking:${threadId}`)
  ctx.liveState.delete(`tasks:${threadId}`)
}

export function clearThreadLiveState(ctx: LiveStateCtx, threadId: ThreadId): void {
  const prefix = `commands:${threadId}\u0000`
  for (const key of ctx.liveState.keys()) if (key.startsWith(prefix)) ctx.liveState.delete(key)
  clearTurnLiveState(ctx, threadId)
}

function scopedThread(key: string): ThreadId | undefined {
  if (key.startsWith("thinking:")) return key.slice("thinking:".length) as ThreadId
  if (key.startsWith("tasks:")) return key.slice("tasks:".length) as ThreadId
  if (!key.startsWith("commands:")) return undefined
  const rest = key.slice("commands:".length)
  const end = rest.indexOf("\u0000")
  return (end === -1 ? rest : rest.slice(0, end)) as ThreadId
}

/** 当前进程仍成立、而 journal 有意不保存的状态快照。 */
export function liveStateOf(ctx: LiveStateCtx): readonly Event[] {
  return [...ctx.liveState.entries()]
    .filter(([key]) => {
      const threadId = scopedThread(key)
      return threadId === undefined || ctx.live.has(threadId)
    })
    .map(([, event]) => event)
}
