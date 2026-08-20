import type { Event, ItemId, ToolCallItem, TurnId, TurnStatus } from "@omni/protocol"
import { planSteps } from "./plan.js"
import { finishTool, startTool, sweepTool } from "./tool.js"
import type { KimiPayload, KimiSnapshot } from "./wire.js"

interface TextState {
  id: ItemId
  kind: "agent_message" | "reasoning"
  text: string
  started: boolean
}

interface Active {
  generation: number
  turnId: TurnId
  prompt: string
  promptId?: string
  native?: number
  assistant: TextState
  reasoning: TextState
  tools: Map<string, ToolCallItem>
  planStarted: boolean
}

export interface TurnTrackerDeps {
  emit: (event: Event) => void
  now: () => number
}

function messageOf(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw
  if (typeof raw !== "object" || raw === null) return undefined
  const message = (raw as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}

function turnStatus(reason: string | undefined): TurnStatus {
  if (reason === "cancelled") return "interrupted"
  if (reason === "failed" || reason === "blocked") return "failed"
  return "completed"
}

export class KimiTurnTracker {
  private active: Active | undefined
  private serial = 0

  constructor(private readonly deps: TurnTrackerDeps) {}

  begin(turnId: TurnId, prompt: string): number {
    if (this.active !== undefined) throw new Error("Kimi 还有一轮正在运行")
    const generation = ++this.serial
    this.active = {
      generation,
      turnId,
      prompt,
      assistant: { id: `kimi-answer-${turnId}`, kind: "agent_message", text: "", started: false },
      reasoning: { id: `kimi-thinking-${turnId}`, kind: "reasoning", text: "", started: false },
      tools: new Map(),
      planStarted: false,
    }
    return generation
  }

  promptAccepted(generation: number, promptId: string): void {
    if (this.active?.generation === generation) this.active.promptId = promptId
  }

  isActive(generation: number): boolean {
    return this.active?.generation === generation
  }

  hasActive(): boolean {
    return this.active !== undefined
  }

  currentGeneration(): number | undefined {
    return this.active?.generation
  }

  currentPromptId(): string | undefined {
    return this.active?.promptId
  }

  private bind(native: number | undefined, prompt?: string): Active | undefined {
    const active = this.active
    if (active === undefined || native === undefined) return undefined
    if (active.native !== undefined) return active.native === native ? active : undefined
    if (prompt !== undefined && prompt !== active.prompt) return undefined
    active.native = native
    return active
  }

  started(payload: KimiPayload): void {
    this.bind(payload.turnId, payload.prompt)
  }

  private append(state: TextState, active: Active, delta: string, at: number): void {
    if (delta === "") return
    if (!state.started) {
      state.started = true
      state.text = delta
      this.deps.emit({
        type: "item.started",
        at,
        item: { id: state.id, turnId: active.turnId, at, kind: state.kind, text: delta, complete: false },
      })
      return
    }
    state.text += delta
    this.deps.emit({ type: "item.delta", at, itemId: state.id, append: delta })
  }

  delta(payload: KimiPayload, kind: TextState["kind"], at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined || payload.delta === undefined) return
    this.append(kind === "reasoning" ? active.reasoning : active.assistant, active, payload.delta, at)
  }

  toolStarted(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    const steps = planSteps(payload.display)
    if (steps !== undefined) {
      if (steps.length > 0) {
        this.deps.emit({
          type: active.planStarted ? "item.updated" : "item.started",
          at,
          item: { id: `kimi-plan-${active.turnId}`, turnId: active.turnId, at, kind: "plan", steps },
        })
        active.planStarted = true
      }
      return
    }
    const item = startTool(payload, active.turnId, at)
    if (item === undefined || active.tools.has(item.id)) return
    active.tools.set(item.id, item)
    this.deps.emit({ type: "item.started", at, item })
  }

  toolProgress(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const item = active?.tools.get(payload.toolCallId ?? "")
    const text = payload.update?.text
    if (item?.detail.kind !== "shell" || text === undefined || text === "") return
    this.deps.emit({ type: "item.delta", at, itemId: item.id, append: text })
  }

  toolResult(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const item = active?.tools.get(payload.toolCallId ?? "")
    if (active === undefined || item === undefined) return
    const done = finishTool(item, payload.output, payload.isError === true)
    active.tools.set(done.id, done)
    this.deps.emit({ type: "item.updated", at, item: done })
  }

  notice(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const message = payload.message ?? messageOf(payload.error)
    if (active === undefined || message === undefined) return
    const id = `kimi-error-${active.turnId}-${String(at)}`
    this.deps.emit({
      type: "item.started",
      at,
      item: { id, turnId: active.turnId, at, kind: "error", message, fatal: payload.retryable !== true },
    })
  }

  retry(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    const message = typeof payload.errorMessage === "string" ? payload.errorMessage : "Kimi 正在重试这一轮"
    const id = `kimi-retry-${active.turnId}`
    this.deps.emit({
      type: "item.started",
      at,
      item: { id, turnId: active.turnId, at, kind: "error", message, fatal: false },
    })
  }

  ended(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    this.complete(active, turnStatus(payload.reason), at, messageOf(payload.error))
  }

  private finishText(state: TextState, active: Active, at: number): void {
    if (!state.started) return
    this.deps.emit({
      type: "item.updated",
      at,
      item: { id: state.id, turnId: active.turnId, at, kind: state.kind, text: state.text, complete: true },
    })
  }

  private complete(active: Active, status: TurnStatus, at: number, error?: string): void {
    this.finishText(active.reasoning, active, at)
    this.finishText(active.assistant, active, at)
    if (status !== "completed") {
      const ending = status === "interrupted" ? "interrupted" : "failed"
      for (const item of active.tools.values()) {
        const swept = sweepTool(item, ending)
        if (swept !== item) this.deps.emit({ type: "item.updated", at, item: swept })
      }
    }
    this.active = undefined
    this.deps.emit({
      type: "turn.completed",
      at,
      turnId: active.turnId,
      status,
      ...(error === undefined ? {} : { error }),
    })
  }

  fail(message: string): void {
    const active = this.active
    if (active === undefined) return
    this.complete(active, "failed", this.deps.now(), message)
  }

  private syncText(state: TextState, active: Active, text: string, at: number): void {
    if (text === "" || text === state.text) return
    state.text = text
    const item = { id: state.id, turnId: active.turnId, at, kind: state.kind, text, complete: false } as const
    if (!state.started) {
      state.started = true
      this.deps.emit({ type: "item.started", at, item })
      return
    }
    this.deps.emit({ type: "item.updated", at, item })
  }

  reconcile(snapshot: KimiSnapshot): void {
    const active = this.active
    if (active === undefined) return
    const at = this.deps.now()
    const flight = snapshot.in_flight_turn
    if (flight === null) {
      this.complete(active, turnStatus(snapshot.session.last_turn_reason), at)
      return
    }
    if (this.bind(flight.turn_id) === undefined) return
    active.promptId ??= flight.current_prompt_id
    this.syncText(active.assistant, active, flight.assistant_text, at)
    this.syncText(active.reasoning, active, flight.thinking_text, at)
    for (const tool of flight.running_tools) {
      this.toolStarted(
        { turnId: flight.turn_id, toolCallId: tool.tool_call_id, name: tool.name, args: tool.args, display: tool.display },
        at,
      )
      if (tool.last_progress?.text !== undefined) {
        this.toolProgress({ turnId: flight.turn_id, toolCallId: tool.tool_call_id, update: tool.last_progress }, at)
      }
    }
  }
}

type TurnHandler = (tracker: KimiTurnTracker, payload: KimiPayload, at: number) => void

const TURN_HANDLERS: Readonly<Record<string, TurnHandler>> = {
  "turn.started": (tracker, payload) => tracker.started(payload),
  "assistant.delta": (tracker, payload, at) => tracker.delta(payload, "agent_message", at),
  "thinking.delta": (tracker, payload, at) => tracker.delta(payload, "reasoning", at),
  "tool.call.started": (tracker, payload, at) => tracker.toolStarted(payload, at),
  "tool.progress": (tracker, payload, at) => tracker.toolProgress(payload, at),
  "tool.result": (tracker, payload, at) => tracker.toolResult(payload, at),
  "turn.step.retrying": (tracker, payload, at) => tracker.retry(payload, at),
  error: (tracker, payload, at) => tracker.notice(payload, at),
  warning: (tracker, payload, at) => tracker.notice(payload, at),
  "turn.ended": (tracker, payload, at) => tracker.ended(payload, at),
}

export function handleTurnEvent(tracker: KimiTurnTracker, payload: KimiPayload, at: number): void {
  const type = payload.type
  if (type !== undefined) TURN_HANDLERS[type]?.(tracker, payload, at)
}
