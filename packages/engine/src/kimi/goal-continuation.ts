import type { GoalContinuationOrigin } from "@omni/protocol"
import type { NativeTurnStart } from "../contract.js"
import type { KimiPayload, KimiTranscriptTurn } from "./wire.js"

export interface StartedGoalContinuation {
  native: number
  turnId: string
  prompt: string
}

const GOAL_CONTINUATION: GoalContinuationOrigin = { kind: "goal_continuation" }

const objectOf = (raw: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Readonly<Record<string, unknown>>
    : undefined

/** 实时帧给 system_trigger；transcript 把非用户来源包进 other.payload。 */
export function isKimiGoalContinuation(raw: unknown): boolean {
  const outer = objectOf(raw)
  const origin = outer?.["kind"] === "other" ? objectOf(outer["payload"]) : outer
  return origin?.["kind"] === "system_trigger" && origin["name"] === "goal_continuation"
}

/** 断线接入时没有上一条宿主轮可续，按 Kimi 的空提示边界建立一轮。 */
export class KimiGoalContinuationBridge {
  constructor(
    private readonly begin: ((turn: NativeTurnStart) => string | undefined) | undefined,
  ) {}

  started(payload: KimiPayload, at: number): StartedGoalContinuation | undefined {
    if (payload.turnId === undefined || !isKimiGoalContinuation(payload.origin)) return undefined
    return this.claim(payload.turnId, at)
  }

  recover(
    turn: KimiTranscriptTurn,
    native: number,
    at: number,
  ): StartedGoalContinuation | undefined {
    if (turn.turnId !== `t${String(native)}` || !isKimiGoalContinuation(turn.origin)) return undefined
    return this.claim(native, at)
  }

  private claim(native: number, at: number): StartedGoalContinuation | undefined {
    const prompt = ""
    const turnId = this.begin?.({ at, prompt, origin: GOAL_CONTINUATION })
    return turnId === undefined ? undefined : { native, turnId, prompt }
  }
}
