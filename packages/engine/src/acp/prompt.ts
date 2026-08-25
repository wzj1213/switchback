import type { TurnId } from "@omni/protocol"
import type { NativeTurnStart } from "../contract.js"
import type { RpcPeer } from "../rpc.js"
import { imageBlocks } from "./attach.js"
import type { ForeignTurn } from "./caps.js"
import { AcpNativeTurnQueue } from "./native-turn.js"
import type { AcpPromptResult } from "./wire.js"

interface PromptState {
  acpSession: string | undefined
  turn: TurnId | undefined
  caps: { attachments: boolean }
}

interface PromptBridgeOptions {
  id: string
  rpc: Pick<RpcPeer, "call">
  state: PromptState
  promptMeta: ((turnId: TurnId) => Readonly<Record<string, unknown>> | undefined) | undefined
  begin: ((turn: NativeTurnStart) => TurnId | undefined) | undefined
  complete: (turnId: TurnId, reason: AcpPromptResult["stopReason"]) => void
  fail: (turnId: TurnId, message: string) => void
  now: () => number
}

/** 普通 ACP prompt 与引擎主动 prompt 共用同一条 RPC、元数据和终态回路。 */
export class AcpPromptBridge {
  private readonly nativeTurns: AcpNativeTurnQueue

  constructor(private readonly options: PromptBridgeOptions) {
    this.nativeTurns = new AcpNativeTurnQueue({
      begin: options.begin,
      now: options.now,
      send: (turn, turnId) => this.sendNative(turn, turnId),
    })
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    const { state } = this.options
    if (state.acpSession === undefined) throw new Error(`${this.options.id} 会话尚未就绪`)
    const prompt = [{ type: "text", text }, ...(await imageBlocks(attachments, state.caps.attachments))]
    this.send(prompt, turnId, this.options.promptMeta?.(turnId))
    this.nativeTurns.poke()
  }

  enqueue(turn: ForeignTurn): void {
    this.nativeTurns.enqueue(turn)
  }

  settled(turnId: TurnId): void {
    this.nativeTurns.settled(turnId)
  }

  private sendNative(turn: ForeignTurn, turnId: TurnId): void {
    const base = this.options.promptMeta?.(turnId) ?? {}
    const meta = { ...base, ...(turn.promptMeta?.(turnId) ?? {}) }
    this.send([{ type: "text", text: turn.prompt }], turnId, meta)
  }

  private send(
    prompt: readonly unknown[],
    turnId: TurnId,
    meta: Readonly<Record<string, unknown>> | undefined,
  ): void {
    const { state } = this.options
    if (state.acpSession === undefined) {
      this.options.fail(turnId, `${this.options.id} 会话尚未就绪`)
      return
    }
    state.turn = turnId
    this.options.rpc.call("session/prompt", {
      sessionId: state.acpSession, prompt, ...(meta === undefined ? {} : { _meta: meta }),
    }).then(
      (result) => this.options.complete(turnId, (result as AcpPromptResult | undefined)?.stopReason),
      (error: unknown) => this.options.fail(turnId, error instanceof Error ? error.message : String(error)),
    )
  }
}
