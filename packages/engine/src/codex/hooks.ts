import type { Event, ThreadId, ToolCallItem, ToolStatus, TurnId, TurnStatus } from "@switchback/protocol"
import type { WireHookLifecycle, WireHookRun } from "./wire.js"

interface HookContext {
  threadId: ThreadId
  turnId: () => TurnId | undefined
  emit: (event: Event) => void
  now: () => number
}

interface ActiveHook {
  run: WireHookRun
  turnId: TurnId | undefined
  at: number
  materialized: boolean
  timer?: ReturnType<typeof setTimeout>
}

export interface HookTracker {
  started: (lifecycle: WireHookLifecycle) => void
  completed: (lifecycle: WireHookLifecycle) => void
  settle: (turnId: TurnId, status: TurnStatus) => void
  close: () => void
}

/** 跟 Codex TUI 一样，短于 300ms 的无输出 hook 不闪一下界面。 */
const REVEAL_MS = 300

const STATUS: Readonly<Record<string, ToolStatus>> = {
  running: "running",
  completed: "ok",
  failed: "failed",
  blocked: "denied",
  stopped: "denied",
}

function outputOf(run: WireHookRun): string | undefined {
  const lines = (run.entries ?? []).flatMap((entry) => {
    if (typeof entry.text !== "string" || entry.text === "") return []
    return [`${entry.kind ?? "output"}: ${entry.text}`]
  })
  return lines.length === 0 ? undefined : lines.join("\n")
}

function hookItem(active: ActiveHook, run: WireHookRun): ToolCallItem | undefined {
  const { turnId } = active
  if (turnId === undefined) return undefined
  const eventName = run.eventName ?? "hook"
  const status = STATUS[run.status ?? ""] ?? "running"
  const output = outputOf(run)
  return {
    id: `codex-hook-${run.id}`,
    turnId,
    at: active.at,
    kind: "tool_call",
    tool: `hook/${eventName}`,
    status,
    detail: {
      kind: "other",
      name: run.statusMessage?.trim() || `${eventName} hook`,
      input: {
        handlerType: run.handlerType,
        executionMode: run.executionMode,
        scope: run.scope,
        source: run.source,
        sourcePath: run.sourcePath,
      },
      ...(output === undefined ? {} : { output }),
    },
    ...(status === "failed" || status === "denied"
      ? (output === undefined ? {} : { error: output })
      : {}),
  }
}

function meaningful(run: WireHookRun): boolean {
  return run.status !== "completed" || (run.entries?.length ?? 0) > 0
}

/** 没有宿主轮次的 session-end 异常仍不能无声；普通 context 不冒充能力降级。 */
function outOfTurnWarning(run: WireHookRun): string | undefined {
  const output = outputOf(run)
  const alarmingEntry = run.entries?.some((entry) => entry.kind !== "context") === true
  if (run.status === "completed" && !alarmingEntry) return undefined
  const eventName = run.eventName ?? "hook"
  const label = run.statusMessage?.trim() || `${eventName} hook`
  return [label, output].filter((part): part is string => part !== undefined).join("\n")
}

function stopTimer(active: ActiveHook | undefined): void {
  if (active?.timer !== undefined) clearTimeout(active.timer)
}

function hookKey(lifecycle: WireHookLifecycle): string | undefined {
  const id = lifecycle.run.id
  if (typeof id !== "string" || id === "") return undefined
  return `${lifecycle.turnId ?? "session"}\u0000${id}`
}

function activeHook(ctx: HookContext, lifecycle: WireHookLifecycle, previous?: ActiveHook): ActiveHook {
  return {
    run: lifecycle.run,
    turnId: previous?.turnId ?? (lifecycle.turnId === null ? undefined : ctx.turnId()),
    at: previous?.at ?? ctx.now(),
    materialized: previous?.materialized ?? false,
  }
}

function closeItem(item: ToolCallItem, status: TurnStatus): ToolCallItem {
  if (status === "interrupted") return { ...item, status: "interrupted" }
  const missing = status === "completed"
    ? "Codex 在轮次结束前没有报告这次 hook 的结果。"
    : item.error
  return { ...item, status: "failed", ...(missing === undefined ? {} : { error: missing }) }
}

class CodexHookTracker implements HookTracker {
  private readonly active = new Map<string, ActiveHook>()

  constructor(private readonly ctx: HookContext) {}

  private reveal(id: string): void {
    const current = this.active.get(id)
    if (current === undefined || current.materialized) return
    const item = hookItem(current, current.run)
    if (item === undefined) return
    current.materialized = true
    this.ctx.emit({ type: "item.started", at: this.ctx.now(), item })
  }

  started(lifecycle: WireHookLifecycle): void {
    const key = hookKey(lifecycle)
    if (key === undefined) return
    const { run } = lifecycle
    const previous = this.active.get(key)
    stopTimer(previous)
    const current = activeHook(this.ctx, lifecycle, previous)
    this.active.set(key, current)
    if (current.materialized) {
      const item = hookItem(current, run)
      if (item !== undefined) this.ctx.emit({ type: "item.updated", at: this.ctx.now(), item })
      return
    }
    current.timer = setTimeout(() => this.reveal(key), REVEAL_MS)
  }

  completed(lifecycle: WireHookLifecycle): void {
    const key = hookKey(lifecycle)
    if (key === undefined) return
    const { run } = lifecycle
    const previous = this.active.get(key)
    stopTimer(previous)
    this.active.delete(key)
    const current = previous ?? activeHook(this.ctx, lifecycle)
    if (current.turnId === undefined) {
      const detail = outOfTurnWarning(run)
      if (detail !== undefined) {
        this.ctx.emit({
          type: "engine.status", at: this.ctx.now(), threadId: this.ctx.threadId, status: "degraded", detail,
        })
      }
      return
    }
    if (!current.materialized && !meaningful(run)) return
    const item = hookItem(current, run)
    if (item === undefined) return
    this.ctx.emit({
      type: current.materialized ? "item.updated" : "item.started", at: this.ctx.now(), item,
    })
  }

  settle(turnId: TurnId, status: TurnStatus): void {
    for (const [key, current] of this.active) {
      if (current.turnId !== turnId) continue
      if (current.run.executionMode === "async") continue
      if (current.timer !== undefined) clearTimeout(current.timer)
      if (current.materialized) {
        const item = hookItem(current, current.run)
        if (item !== undefined) {
          this.ctx.emit({
            type: "item.updated", at: this.ctx.now(), item: closeItem(item, status),
          })
        }
      }
      this.active.delete(key)
    }
  }

  close(): void {
    for (const current of this.active.values()) {
      if (current.timer !== undefined) clearTimeout(current.timer)
      if (!current.materialized) continue
      const item = hookItem(current, current.run)
      if (item !== undefined) {
        this.ctx.emit({
          type: "item.updated", at: this.ctx.now(), item: { ...item, status: "interrupted" },
        })
      }
    }
    this.active.clear()
  }
}

export function createHookTracker(ctx: HookContext): HookTracker {
  return new CodexHookTracker(ctx)
}
