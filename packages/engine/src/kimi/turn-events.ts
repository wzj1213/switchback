import type { NativeTurnStart } from "../contract.js"
import { KimiCronBridge } from "./cron.js"
import {
  isKimiGoalContinuation,
  KimiGoalContinuationBridge,
  type StartedGoalContinuation,
} from "./goal-continuation.js"
import { KimiNativeUserBridge, type StartedNativeUser } from "./native-turn.js"
import { KimiStepOutcomes } from "./step-outcome.js"
import type { KimiTurnTracker } from "./turn.js"
import type { KimiPayload, KimiTranscriptTurn } from "./wire.js"

type TurnHandler = (tracker: KimiTurnTracker, payload: KimiPayload, at: number, offset?: number) => unknown

const HANDLERS: Readonly<Record<string, TurnHandler>> = {
  "turn.started": (tracker, payload) => tracker.started(payload),
  "turn.step.started": (tracker, payload, at) => tracker.stepStarted(payload, at),
  "assistant.delta": (tracker, payload, at, offset) => tracker.delta(payload, "agent_message", at, offset),
  "thinking.delta": (tracker, payload, at, offset) => tracker.delta(payload, "reasoning", at, offset),
  "tool.call.started": (tracker, payload, at) => tracker.toolStarted(payload, at),
  "tool.progress": (tracker, payload, at) => tracker.toolProgress(payload, at),
  "tool.result": (tracker, payload, at) => tracker.toolResult(payload, at),
  "hook.result": (tracker, payload, at) => tracker.hookResult(payload, at),
  "turn.step.retrying": (tracker, payload, at) => tracker.retry(payload, at),
  "compaction.started": (tracker, payload, at) => tracker.compaction(payload, at),
  "compaction.blocked": (tracker, payload, at) => tracker.compaction(payload, at),
  "compaction.completed": (tracker, payload, at) => tracker.compaction(payload, at),
  "compaction.cancelled": (tracker, payload, at) => tracker.compaction(payload, at),
  error: (tracker, payload, at) => tracker.notice(payload, at),
  warning: (tracker, payload, at) => tracker.notice(payload, at),
  "turn.ended": (tracker, payload, at) => tracker.ended(payload, at),
}

/** 普通宿主发起轮次的无状态分派，也供状态机单测直接使用。 */
export function handleTurnEvent(
  tracker: KimiTurnTracker,
  payload: KimiPayload,
  at: number,
  offset?: number,
): boolean {
  const type = payload.type
  return type !== undefined && HANDLERS[type]?.(tracker, payload, at, offset) === true
}

/** 轮次事件的有状态入口；cron 两帧配对留在协议适配层，不污染通用轮次状态机。 */
export class KimiTurnEvents {
  private readonly cron: KimiCronBridge
  private readonly goalContinuation: KimiGoalContinuationBridge
  private readonly nativeUser: KimiNativeUserBridge
  private readonly steps: KimiStepOutcomes

  constructor(
    private readonly tracker: KimiTurnTracker,
    beginNative: ((turn: NativeTurnStart) => string | undefined) | undefined,
    private readonly goalActive: () => boolean = () => false,
  ) {
    this.cron = new KimiCronBridge(beginNative)
    this.goalContinuation = new KimiGoalContinuationBridge(beginNative)
    this.nativeUser = new KimiNativeUserBridge(beginNative)
    this.steps = new KimiStepOutcomes(tracker)
  }

  handle(payload: KimiPayload, at: number, offset?: number): boolean {
    if (this.steps.handle(payload, at)) return false
    if (this.continueGoal(payload, at)) return false
    if (this.holdGoal(payload, at)) return false
    if (this.beginUnowned(payload, at)) return false
    if (payload.type === "cron.fired") {
      this.beginCron(payload)
      return false
    }
    return handleTurnEvent(this.tracker, payload, at, offset)
  }

  private continueGoal(payload: KimiPayload, at: number): boolean {
    return payload.type === "turn.started" &&
      payload.turnId !== undefined &&
      isKimiGoalContinuation(payload.origin) &&
      this.tracker.continueNative(payload.turnId, at)
  }

  private holdGoal(payload: KimiPayload, at: number): boolean {
    return payload.type === "turn.ended" &&
      this.goalActive() &&
      this.tracker.holdForContinuation(payload, at)
  }

  private beginUnowned(payload: KimiPayload, at: number): boolean {
    if (payload.type !== "turn.started" || this.tracker.hasActive()) return false
    if (this.cron.started(payload, at)) return true
    this.bindNative(
      this.nativeUser.started(payload, at) ?? this.goalContinuation.started(payload, at),
    )
    return this.tracker.hasActive()
  }

  private beginCron(payload: KimiPayload): void {
    const start = this.cron.fired(payload)
    this.bindNative(start)
  }

  recoverNative(turn: KimiTranscriptTurn, native: number, at: number): void {
    if (
      this.tracker.isAwaitingContinuation() &&
      turn.turnId === `t${String(native)}` &&
      isKimiGoalContinuation(turn.origin)
    ) {
      this.tracker.continueNative(native, at)
      return
    }
    if (this.tracker.hasActive()) return
    this.bindNative(
      this.cron.recover(turn, native, at) ??
        this.nativeUser.recover(turn, native, at) ??
        this.goalContinuation.recover(turn, native, at),
    )
  }

  goalChanged(active: boolean, at: number): void {
    if (!active) this.tracker.finishAwaitingContinuation(at)
  }

  private bindNative(
    start: ReturnType<KimiCronBridge["fired"]> | StartedNativeUser | StartedGoalContinuation | undefined,
  ): void {
    if (start === undefined || this.tracker.hasActive()) return
    this.tracker.begin(start.turnId, start.prompt)
    this.tracker.started({ turnId: start.native, prompt: start.prompt })
  }
}
