import type { NativeTurnStart } from "../contract.js"
import type { KimiPayload, KimiTranscriptTurn } from "./wire.js"

export interface StartedNativeUser {
  native: number
  turnId: string
  prompt: string
}

const objectOf = (raw: unknown): Record<string, unknown> | undefined =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined

/** 实时 origin 是 user；历史外层仍是 user，但 shell_command 也借了这层，必须排除。 */
function isUserOrigin(raw: unknown): boolean {
  const outer = objectOf(raw)
  if (outer?.["kind"] !== "user") return false
  return objectOf(outer["payload"])?.["kind"] !== "shell_command"
}

/** 同一 Kimi 会话的其他原生客户端自行开启普通用户轮时，请宿主同步建立主线。 */
export class KimiNativeUserBridge {
  constructor(
    private readonly begin: ((turn: NativeTurnStart) => string | undefined) | undefined,
  ) {}

  started(payload: KimiPayload, at: number): StartedNativeUser | undefined {
    if (
      payload.turnId === undefined ||
      typeof payload.prompt !== "string" ||
      !isUserOrigin(payload.origin)
    ) {
      return undefined
    }
    return this.claim(payload.turnId, payload.prompt, at)
  }

  recover(turn: KimiTranscriptTurn, native: number, at: number): StartedNativeUser | undefined {
    if (
      turn.turnId !== `t${String(native)}` ||
      typeof turn.prompt !== "string" ||
      !isUserOrigin(turn.origin)
    ) {
      return undefined
    }
    return this.claim(native, turn.prompt, at)
  }

  private claim(native: number, prompt: string, at: number): StartedNativeUser | undefined {
    const turnId = this.begin?.({ at, prompt })
    return turnId === undefined ? undefined : { native, turnId, prompt }
  }
}
