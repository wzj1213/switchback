import type { Event, TurnId } from "@switchback/protocol"
import { planSteps } from "./plan.js"
import { finishTool, startTool } from "./tool.js"
import { kimiMessage, kimiTurnStatus, snapshotCanFinish, snapshotMatches } from "./turn-state.js"
import type { KimiPayload, KimiSnapshot } from "./wire.js"
import {
  compactionAfterGap, compactionEvent, compactionUpdate, type CompactionUpdate, type KimiOperation,
} from "./compaction.js"
import { kimiHookResult } from "./hook-result.js"
import { kimiNotice } from "./notice.js"
import { kimiNativePartId } from "./native-part.js"
import { kimiRetryEvent } from "./retry.js"
import { alignKimiDelta, kimiTextState, type KimiTextState } from "./text-stream.js"
import type { KimiActiveTurn } from "./turn-active.js"
import { KimiTurnFinalizer } from "./turn-finalize.js"

export interface TurnTrackerDeps {
  emit: (event: Event) => void
  now: () => number
}

export class KimiTurnTracker {
  private active: KimiActiveTurn | undefined
  private readonly finalizer: KimiTurnFinalizer
  private serial = 0

  constructor(private readonly deps: TurnTrackerDeps) {
    this.finalizer = new KimiTurnFinalizer({
      ...deps,
      current: () => this.active,
      clear: (active) => { if (this.active === active) this.active = undefined },
    })
  }

  begin(turnId: TurnId, prompt: string, operation: KimiOperation = "prompt"): number {
    if (this.active !== undefined) throw new Error("Kimi 还有一轮正在运行")
    const generation = ++this.serial
    this.active = {
      generation,
      startedAt: this.deps.now(),
      turnId,
      prompt,
      operation,
      activationAccepted: false,
      nativePart: 1,
      step: 0,
      assistant: kimiTextState(turnId, "agent_message"),
      reasoning: kimiTextState(turnId, "reasoning"),
      tools: new Map(),
      planStarted: false,
      retryStarted: false,
      compactionStarted: false,
      noticeSeq: 0,
      awaitingContinuation: false,
    }
    return generation
  }

  promptAccepted(generation: number, promptId: string): void {
    if (this.active?.generation === generation) this.active.promptId = promptId
  }

  activationAccepted(generation: number): void {
    if (this.active?.generation === generation) this.active.activationAccepted = true
  }

  isActive(generation: number): boolean {
    return this.active?.generation === generation
  }

  hasActive(): boolean {
    return this.active !== undefined
  }

  isAwaitingContinuation(): boolean {
    return this.active?.awaitingContinuation === true
  }

  currentGeneration(): number | undefined {
    return this.active?.generation
  }

  currentPromptId(): string | undefined {
    return this.active?.promptId
  }

  currentNative(): number | undefined { return this.active?.native }
  currentTurnId(): TurnId | undefined { return this.active?.turnId }
  currentPrompt(): string | undefined { return this.active?.prompt }
  currentStartedAt(): number | undefined { return this.active?.startedAt }
  currentStep(): number { return this.active?.step ?? 0 }

  private bind(native: number | undefined, prompt?: string): KimiActiveTurn | undefined {
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

  private append(state: KimiTextState, active: KimiActiveTurn, delta: string, at: number): void {
    if (delta === "") return
    if (!state.started) {
      state.started = true
      state.text = delta
      state.total += delta
      this.deps.emit({
        type: "item.started",
        at,
        item: { id: state.id, turnId: active.turnId, at, kind: state.kind, text: delta, complete: false },
      })
      return
    }
    state.text += delta
    state.total += delta
    this.deps.emit({ type: "item.delta", at, itemId: state.id, append: delta })
  }

  private stateOf(active: KimiActiveTurn, kind: KimiTextState["kind"]): KimiTextState {
    return kind === "reasoning" ? active.reasoning : active.assistant
  }

  private rotateText(state: KimiTextState, active: KimiActiveTurn, at: number): void {
    if (!state.started) return
    this.finalizer.finishText(state, active, at)
    const next = kimiTextState(active.turnId, state.kind, state.part + 1, state.total)
    if (state.kind === "reasoning") active.reasoning = next
    else active.assistant = next
  }

  private selectText(active: KimiActiveTurn, kind: KimiTextState["kind"], at: number): KimiTextState {
    if (active.openText !== undefined && active.openText !== kind) {
      this.rotateText(this.stateOf(active, active.openText), active, at)
    }
    active.openText = kind
    return this.stateOf(active, kind)
  }

  /** 任何真正插进 transcript 的非文本 item 都会切断连续文本。 */
  private closeText(active: KimiActiveTurn, at: number): void {
    this.rotateText(active.reasoning, active, at)
    this.rotateText(active.assistant, active, at)
    active.openText = undefined
  }

  delta(payload: KimiPayload, kind: KimiTextState["kind"], at: number, offset?: number): boolean {
    const active = this.bind(payload.turnId)
    if (active === undefined || payload.delta === undefined) return false
    const state = this.stateOf(active, kind)
    const placement = alignKimiDelta(state.total, offset, payload.delta)
    if (placement.gap !== undefined) return true
    if (placement.append !== undefined) this.append(this.selectText(active, kind, at), active, placement.append, at)
    return false
  }

  stepStarted(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined || payload.step === undefined || payload.step <= active.step) return
    this.closeText(active, at)
    active.step = payload.step
    active.assistant.total = ""
    active.reasoning.total = ""
  }

  toolStarted(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    const steps = planSteps(payload.display)
    if (steps !== undefined) {
      if (steps.length > 0) {
        this.closeText(active, at)
        this.deps.emit({
          type: active.planStarted ? "item.updated" : "item.started",
          at,
          item: {
            id: kimiNativePartId("kimi-plan", active.turnId, active.nativePart),
            turnId: active.turnId,
            at,
            kind: "plan",
            steps,
          },
        })
        active.planStarted = true
      }
      return
    }
    const item = startTool(payload, active.turnId, at)
    if (item === undefined || active.tools.has(item.id)) return
    this.closeText(active, at)
    active.tools.set(item.id, item)
    this.deps.emit({ type: "item.started", at, item })
  }

  toolProgress(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const item = active?.tools.get(payload.toolCallId ?? "")
    const text = payload.update?.text
    if (item?.detail.kind !== "shell" || text === undefined || text === "") return
    active?.tools.set(item.id, {
      ...item,
      detail: { ...item.detail, output: `${item.detail.output ?? ""}${text}` },
    })
    this.deps.emit({ type: "item.delta", at, itemId: item.id, append: text })
  }

  toolResult(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const item = active?.tools.get(payload.toolCallId ?? "")
    if (active === undefined || item === undefined || (item.status !== "running" && item.status !== "pending")) return
    const done = finishTool(item, payload.output, payload.isError === true)
    active.tools.set(done.id, done)
    this.deps.emit({ type: "item.updated", at, item: done })
  }

  notice(payload: KimiPayload, at: number): boolean {
    const active = this.bind(payload.turnId)
    const item = active === undefined ? undefined : kimiNotice(payload, active.turnId, at, active.noticeSeq + 1)
    if (active === undefined || item === undefined) return false
    this.closeText(active, at)
    active.noticeSeq += 1
    this.deps.emit({ type: "item.started", at, item })
    return true
  }

  hookResult(payload: KimiPayload, at: number): void {
    // v2 在 prompt admission 阶段发 HookResult，公开 schema 允许没有 turnId；
    // 此时只可能属于尚未启动 native turn 的当前宿主 prompt。
    const unbound = this.active?.native === undefined ? this.active : undefined
    const active = payload.turnId === undefined ? unbound : this.bind(payload.turnId)
    const item = active === undefined ? undefined : kimiHookResult(payload, active.turnId, at, active.noticeSeq + 1)
    if (active === undefined || item === undefined) return
    this.closeText(active, at)
    active.noticeSeq += 1
    this.deps.emit({ type: "item.started", at, item })
  }

  retry(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    this.closeText(active, at)
    this.deps.emit(
      kimiRetryEvent(
        payload,
        active.turnId,
        { started: active.retryStarted, part: active.nativePart },
        at,
      ),
    )
    active.retryStarted = true
  }

  compaction(payload: KimiPayload, at: number): void {
    const active = this.active
    const update = active === undefined ? undefined : compactionUpdate(active.operation, payload)
    if (active !== undefined && update !== undefined) this.applyCompaction(active, update, at)
  }

  private applyCompaction(active: KimiActiveTurn, update: CompactionUpdate, at: number): void {
    this.closeText(active, at)
    const part = { started: active.compactionStarted, part: active.nativePart }
    this.deps.emit(compactionEvent(active.turnId, part, update, at))
    active.compactionStarted = true
    if (update.finish !== undefined) this.finalizer.complete(active, update.finish, at)
  }

  ended(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    this.finalizer.complete(active, kimiTurnStatus(payload.reason), at, kimiMessage(payload.error))
  }

  /** Kimi 目标仍 active 时，原生 turn 收口但宿主轮不交还控制权。 */
  holdForContinuation(payload: KimiPayload, at: number): boolean {
    const active = this.bind(payload.turnId)
    const continues = payload.reason === "completed" || payload.interruptReason === "max_steps"
    return this.finalizer.hold(active, continues, at)
  }

  /** 下一条公开 goal_continuation 接着使用同一宿主轮，并留下不含伪造正文的边界。 */
  continueNative(native: number, at: number): boolean {
    return this.finalizer.continue(native, at)
  }

  finishAwaitingContinuation(at: number): void {
    this.finalizer.finishAwaiting(at)
  }

  fail(message: string): void {
    this.finalizer.fail(message)
  }

  failGeneration(generation: number, message: string): void {
    if (this.isActive(generation)) this.fail(message)
  }

  private syncText(state: KimiTextState, active: KimiActiveTurn, text: string, at: number): void {
    const placement = alignKimiDelta(state.total, 0, text)
    if (placement.append !== undefined) this.append(this.selectText(active, state.kind, at), active, placement.append, at)
  }

  private reconcileFlight(active: KimiActiveTurn, snapshot: KimiSnapshot, at: number): void {
    const flight = snapshot.in_flight_turn
    if (flight === null) return
    if (!snapshotMatches(active.native, active.promptId, active.activationAccepted, snapshot)) return
    if (this.bind(flight.turn_id) === undefined) return
    active.promptId ??= flight.current_prompt_id
    this.syncText(active.reasoning, active, flight.thinking_text, at)
    this.syncText(active.assistant, active, flight.assistant_text, at)
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

  private reconcileIdle(active: KimiActiveTurn, snapshot: KimiSnapshot, at: number): void {
    if (active.awaitingContinuation) return
    // `begin()` 发生在图片编码与 POST 之前；窗口里的空闲快照说的是旧状态，不能提前收掉新轮。
    if (!snapshotCanFinish(active.promptId !== undefined || active.activationAccepted, snapshot)) return
    this.finalizer.complete(active, kimiTurnStatus(snapshot.session.last_turn_reason), at)
  }

  reconcile(snapshot: KimiSnapshot): void {
    const active = this.active
    if (active === undefined) return
    const at = this.deps.now()
    if (active.operation === "compact") {
      const update = compactionAfterGap(active.activationAccepted, snapshot)
      if (update !== undefined) this.applyCompaction(active, update, at)
    } else if (snapshot.in_flight_turn === null) this.reconcileIdle(active, snapshot, at)
    else this.reconcileFlight(active, snapshot, at)
  }
}
