import { readKimiRecentTurns } from "./history.js"
import type { KimiApi } from "./http.js"
import type { KimiTurnEvents } from "./turn-events.js"
import type { KimiTurnTracker } from "./turn.js"
import type { KimiSnapshot, KimiTranscriptTurn } from "./wire.js"
import { recoverKimiTranscript } from "./turn-transcript.js"

interface RecoveryDeps {
  api: KimiApi
  sessionId: string
  events: KimiTurnEvents
  tracker: KimiTurnTracker
  now: () => number
}

function turnAt(turn: KimiTranscriptTurn, fallback: number): number {
  if (turn.startedAt === undefined) return fallback
  const at = new Date(turn.startedAt).getTime()
  return Number.isNaN(at) ? fallback : at
}

function activeTurn(
  deps: RecoveryDeps,
  turns: readonly KimiTranscriptTurn[],
  flight: KimiSnapshot["in_flight_turn"],
): KimiTranscriptTurn | undefined {
  if (deps.tracker.isAwaitingContinuation() && flight === null) return undefined
  const native = deps.tracker.currentNative() ?? flight?.turn_id
  if (native !== undefined) return turns.find((turn) => turn.turnId === `t${String(native)}`)
  const prompt = deps.tracker.currentPrompt()
  const began = deps.tracker.currentStartedAt()
  return turns.findLast((turn) => {
    const started = turn.startedAt === undefined ? Number.NaN : new Date(turn.startedAt).getTime()
    return (
      prompt !== "" &&
      turn.prompt === prompt &&
      began !== undefined &&
      !Number.isNaN(started) &&
      started >= began
    )
  })
}

/** 快照没有 prompt/origin；只用同一公开 transcript 的精确 turn id 补回原生轮次。 */
export async function reconcileKimiTurn(deps: RecoveryDeps, snapshot: KimiSnapshot): Promise<void> {
  const flight = snapshot.in_flight_turn
  if (flight !== null && !deps.tracker.hasActive()) {
    const turns = await readKimiRecentTurns(deps.api, deps.sessionId)
    const turn = turns.find((entry) => entry.turnId === `t${String(flight.turn_id)}`)
    if (turn !== undefined) deps.events.recoverNative(turn, flight.turn_id, turnAt(turn, deps.now()))
  } else if (deps.tracker.hasActive()) {
    const turns = await readKimiRecentTurns(deps.api, deps.sessionId)
    const turn = activeTurn(deps, turns, flight)
    if (turn !== undefined) {
      if (flight !== null) {
        deps.events.recoverNative(turn, flight.turn_id, turnAt(turn, deps.now()))
        deps.tracker.started({ turnId: flight.turn_id, prompt: turn.prompt })
      }
      recoverKimiTranscript(deps.tracker, deps.events, turn, deps.now())
    }
  }
  deps.tracker.reconcile(snapshot)
}
