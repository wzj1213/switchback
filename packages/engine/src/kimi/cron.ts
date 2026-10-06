import type { ScheduledMessageOrigin } from "@switchback/protocol"
import type { NativeTurnStart } from "../contract.js"
import type { KimiPayload, KimiTranscriptTurn } from "./wire.js"

interface PendingCron {
  native: number
  at: number
  origin: ScheduledMessageOrigin
}

export interface StartedCron {
  native: number
  turnId: string
  prompt: string
}

const objectOf = (raw: unknown): Record<string, unknown> | undefined =>
  typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined

/** 实时帧是 cron_job；历史 turn 外面再包一层 kind:cron + payload。 */
export function kimiCronOrigin(raw: unknown): ScheduledMessageOrigin | undefined {
  const outer = objectOf(raw)
  const value = outer?.["kind"] === "cron" ? objectOf(outer["payload"]) : outer
  if (value?.["kind"] !== "cron_job") return undefined
  const taskId = value["jobId"]
  const schedule = value["cron"]
  const recurring = value["recurring"]
  const coalescedCount = value["coalescedCount"]
  const stale = value["stale"]
  if (typeof taskId !== "string" || typeof schedule !== "string") return undefined
  if (
    typeof recurring !== "boolean" ||
    typeof coalescedCount !== "number" ||
    typeof stale !== "boolean"
  ) {
    return undefined
  }
  return { kind: "scheduled", taskId, schedule, recurring, coalescedCount, stale }
}

/** Kimi 历史把原任务包在给模型看的 cron-fire XML 里；界面只展示任务原文。 */
export function kimiCronPrompt(prompt: string): string {
  const open = "\n<prompt>\n"
  const close = "\n</prompt>\n</cron-fire>"
  if (!prompt.startsWith("<cron-fire ") || !prompt.endsWith(close)) return prompt
  const start = prompt.indexOf(open)
  return start === -1 ? prompt : prompt.slice(start + open.length, -close.length)
}

/** 配对 Kimi 固定的 turn.started → cron.fired 时序，再向宿主要 turn id。 */
export class KimiCronBridge {
  private pending: PendingCron | undefined

  constructor(
    private readonly begin: ((turn: NativeTurnStart) => string | undefined) | undefined,
  ) {}

  started(payload: KimiPayload, at: number): boolean {
    this.pending = undefined
    const origin = kimiCronOrigin(payload.origin)
    if (origin === undefined || payload.turnId === undefined) return false
    this.pending = { native: payload.turnId, at, origin }
    return true
  }

  fired(payload: KimiPayload): StartedCron | undefined {
    const pending = this.pending
    this.pending = undefined
    const origin = kimiCronOrigin(payload.origin)
    if (pending === undefined || origin === undefined || typeof payload.prompt !== "string")
      return undefined
    if (pending.origin.taskId !== origin.taskId) return undefined
    const turnId = this.begin?.({ at: pending.at, prompt: payload.prompt, origin })
    return turnId === undefined
      ? undefined
      : { native: pending.native, turnId, prompt: payload.prompt }
  }

  /** resync 时 transcript 已给出完整来源，不再等可能已经丢失的 cron.fired。 */
  recover(turn: KimiTranscriptTurn, native: number, at: number): StartedCron | undefined {
    this.pending = undefined
    const origin = kimiCronOrigin(turn.origin)
    if (turn.turnId !== `t${String(native)}` || origin === undefined || typeof turn.prompt !== "string") {
      return undefined
    }
    const prompt = kimiCronPrompt(turn.prompt)
    const turnId = this.begin?.({ at, prompt, origin })
    return turnId === undefined ? undefined : { native, turnId, prompt }
  }
}
