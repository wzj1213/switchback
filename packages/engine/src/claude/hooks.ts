import type { Event, ThreadId, ToolCallItem, ToolStatus, TurnId } from "@switchback/protocol"

interface RawHookMessage {
  subtype?: string
  hook_id?: unknown
  hook_name?: unknown
  hook_event?: unknown
  stdout?: unknown
  stderr?: unknown
  output?: unknown
  exit_code?: unknown
  outcome?: unknown
}

interface HookContext {
  threadId: ThreadId
  turnId: () => TurnId | undefined
  emit: (event: Event) => void
  now: () => number
}

interface ActiveHook {
  id: string
  name: string
  event: string
  turnId: TurnId | undefined
  at: number
  materialized: boolean
  output?: string
  exitCode?: number
  timer?: ReturnType<typeof setTimeout>
}

export interface HookState {
  active: Map<string, ActiveHook>
}

const REVEAL_MS = 300
const MAX_OUTPUT = 4000

export function createHookState(): HookState {
  return { active: new Map() }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function outputOf(msg: RawHookMessage): string | undefined {
  const combined = text(msg.output)
  if (combined !== undefined) return combined
  const separate = [text(msg.stdout), text(msg.stderr)].filter((value): value is string => value !== undefined)
  if (separate.length === 0) return undefined
  return separate.join("\n")
}

function clipped(value: string | undefined): string | undefined {
  if (value === undefined || value.length <= MAX_OUTPUT) return value
  return `${value.slice(0, MAX_OUTPUT)}\n…（已截断）`
}

function statusOf(outcome: unknown): ToolStatus {
  if (outcome === "success") return "ok"
  if (outcome === "cancelled") return "interrupted"
  return outcome === "error" ? "failed" : "running"
}

function itemOf(active: ActiveHook, status: ToolStatus): ToolCallItem | undefined {
  const { turnId } = active
  if (turnId === undefined) return undefined
  return {
    id: `claude-hook-${active.id}`,
    turnId,
    at: active.at,
    kind: "tool_call",
    tool: `hook/${active.event}`,
    status,
    detail: {
      kind: "other",
      name: active.name,
      input: { event: active.event, ...(active.exitCode === undefined ? {} : { exitCode: active.exitCode }) },
      ...(active.output === undefined ? {} : { output: active.output }),
    },
    ...(status === "failed" && active.output !== undefined ? { error: active.output } : {}),
  }
}

function resolvedOutput(msg: RawHookMessage, previous?: ActiveHook): string | undefined {
  const output = clipped(outputOf(msg))
  return output === undefined ? previous?.output : output
}

function resolvedExitCode(msg: RawHookMessage, previous?: ActiveHook): number | undefined {
  return typeof msg.exit_code === "number" && Number.isFinite(msg.exit_code)
    ? msg.exit_code
    : previous?.exitCode
}

function activeOf(msg: RawHookMessage, ctx: HookContext, previous?: ActiveHook): ActiveHook | undefined {
  const id = text(msg.hook_id)
  const name = text(msg.hook_name)
  const event = text(msg.hook_event)
  if (id === undefined || name === undefined || event === undefined) return undefined
  if (previous !== undefined) {
    return {
      ...previous, id, name, event,
      output: resolvedOutput(msg, previous),
      exitCode: resolvedExitCode(msg, previous),
    }
  }
  return {
    id,
    name,
    event,
    turnId: ctx.turnId(),
    at: ctx.now(),
    materialized: false,
    output: resolvedOutput(msg),
    exitCode: resolvedExitCode(msg),
  }
}

function reveal(state: HookState, id: string, ctx: HookContext): void {
  const active = state.active.get(id)
  if (active === undefined || active.materialized) return
  const item = itemOf(active, "running")
  if (item === undefined) return
  active.materialized = true
  ctx.emit({ type: "item.started", at: ctx.now(), item })
}

function started(state: HookState, msg: RawHookMessage, ctx: HookContext): void {
  const id = text(msg.hook_id)
  if (id === undefined) return
  const previous = state.active.get(id)
  if (previous?.timer !== undefined) clearTimeout(previous.timer)
  const active = activeOf(msg, ctx, previous)
  if (active === undefined) return
  state.active.set(id, active)
  active.timer = setTimeout(() => reveal(state, id, ctx), REVEAL_MS)
}

function progress(state: HookState, msg: RawHookMessage, ctx: HookContext): void {
  const id = text(msg.hook_id)
  if (id === undefined) return
  const previous = state.active.get(id)
  const active = activeOf(msg, ctx, previous)
  if (active === undefined) return
  if (previous?.timer !== undefined) active.timer = previous.timer
  state.active.set(id, active)
  if (!active.materialized) return
  const item = itemOf(active, "running")
  if (item !== undefined) ctx.emit({ type: "item.updated", at: ctx.now(), item })
}

function outOfTurnFailure(active: ActiveHook, status: ToolStatus, ctx: HookContext): void {
  if (status !== "failed" && status !== "interrupted") return
  const detail = [active.name, active.output].filter((value): value is string => value !== undefined).join("\n")
  ctx.emit({ type: "engine.status", at: ctx.now(), threadId: ctx.threadId, status: "degraded", detail })
}

function responded(state: HookState, msg: RawHookMessage, ctx: HookContext): void {
  const id = text(msg.hook_id)
  if (id === undefined) return
  const previous = state.active.get(id)
  if (previous?.timer !== undefined) clearTimeout(previous.timer)
  state.active.delete(id)
  const active = activeOf(msg, ctx, previous)
  if (active === undefined) return
  const status = statusOf(msg.outcome)
  if (active.turnId === undefined) return outOfTurnFailure(active, status, ctx)
  if (!active.materialized && status === "ok" && active.output === undefined) return
  const item = itemOf(active, status)
  if (item !== undefined) {
    ctx.emit({ type: active.materialized ? "item.updated" : "item.started", at: ctx.now(), item })
  }
}

export function onHookMessage(state: HookState, msg: RawHookMessage, ctx: HookContext): void {
  if (msg.subtype === "hook_started") return started(state, msg, ctx)
  if (msg.subtype === "hook_progress") return progress(state, msg, ctx)
  if (msg.subtype === "hook_response") responded(state, msg, ctx)
}

export function closeHooks(state: HookState, ctx: Pick<HookContext, "emit" | "now">): void {
  for (const active of state.active.values()) {
    if (active.timer !== undefined) clearTimeout(active.timer)
    if (!active.materialized) continue
    const item = itemOf(active, "interrupted")
    if (item !== undefined) ctx.emit({ type: "item.updated", at: ctx.now(), item })
  }
  state.active.clear()
}
