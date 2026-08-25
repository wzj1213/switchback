import type { Event, TurnStatus } from "@omni/protocol"
import { sweepTool } from "./tool.js"
import type { KimiActiveTurn } from "./turn-active.js"
import { kimiTextState, type KimiTextState } from "./text-stream.js"

interface FinalizerDeps {
  emit: (event: Event) => void
  now: () => number
  current: () => KimiActiveTurn | undefined
  clear: (active: KimiActiveTurn) => void
}

export class KimiTurnFinalizer {
  constructor(private readonly deps: FinalizerDeps) {}

  finishText(state: KimiTextState, active: KimiActiveTurn, at: number): void {
    if (!state.started) return
    this.deps.emit({
      type: "item.updated",
      at,
      item: { id: state.id, turnId: active.turnId, at, kind: state.kind, text: state.text, complete: true },
    })
  }

  hold(active: KimiActiveTurn | undefined, completed: boolean, at: number): boolean {
    if (active === undefined || !completed) return false
    this.finishItems(active, "completed", at)
    this.resetNative(active)
    active.awaitingContinuation = true
    return true
  }

  continue(native: number, at: number): boolean {
    const active = this.deps.current()
    if (active === undefined || !active.awaitingContinuation) return false
    active.awaitingContinuation = false
    active.native = native
    this.deps.emit({
      type: "item.started",
      at,
      item: {
        id: `kimi-goal-continuation-${active.turnId}-${String(native)}`,
        turnId: active.turnId,
        at,
        kind: "user_message",
        text: "",
        origin: { kind: "goal_continuation" },
      },
    })
    return true
  }

  finishAwaiting(at: number): void {
    const active = this.deps.current()
    if (active?.awaitingContinuation === true) this.complete(active, "completed", at)
  }

  complete(active: KimiActiveTurn, status: TurnStatus, at: number, error?: string): void {
    this.finishItems(active, status, at)
    this.deps.clear(active)
    this.deps.emit({
      type: "turn.completed",
      at,
      turnId: active.turnId,
      status,
      ...(error === undefined ? {} : { error }),
    })
  }

  fail(message: string): void {
    const active = this.deps.current()
    if (active !== undefined) this.complete(active, "failed", this.deps.now(), message)
  }

  private finishItems(active: KimiActiveTurn, status: TurnStatus, at: number): void {
    this.finishText(active.reasoning, active, at)
    this.finishText(active.assistant, active, at)
    const ending = status === "interrupted" ? "interrupted" : "failed"
    for (const item of active.tools.values()) {
      const missing = status === "completed" && (item.status === "running" || item.status === "pending")
      const swept = missing
        ? { ...item, status: "failed" as const, error: "Kimi 在轮次结束前没有报告这次工具调用的结果。" }
        : sweepTool(item, ending)
      if (swept !== item) this.deps.emit({ type: "item.updated", at, item: swept })
    }
  }

  private resetNative(active: KimiActiveTurn): void {
    delete active.native
    delete active.promptId
    active.activationAccepted = false
    active.nativePart += 1
    active.step = 0
    delete active.openText
    active.tools.clear()
    active.planStarted = false
    active.retryStarted = false
    active.compactionStarted = false
    active.assistant = kimiTextState(active.turnId, "agent_message", active.assistant.part + 1)
    active.reasoning = kimiTextState(active.turnId, "reasoning", active.reasoning.part + 1)
  }
}
