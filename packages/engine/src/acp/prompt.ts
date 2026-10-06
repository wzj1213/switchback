import type { TurnId } from "@switchback/protocol"
import type { NativeTurnStart } from "../contract.js"
import type { RpcPeer } from "../rpc.js"
import { imageBlocks } from "./attach.js"
import type { ForeignTurn } from "./caps.js"
import { AcpNativeTurnQueue } from "./native-turn.js"
import { isAsleep } from "./revive.js"
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
  /**
   * 会话睡着了时把它重新挂上。**挂得回来就重发一次，挂不回来就把两条原因一起报。**
   * 没给这一项就退回老行为（失败原文直接摊出去）。见 `revive.ts`。
   */
  revive?: (() => Promise<void>) | undefined
  now: () => number
}

/** 一次发送的全部内容。**捆成一个**是参数个数闸门逼的，边界也顺：重发要原样再发一遍。 */
interface Sent {
  prompt: readonly unknown[]
  meta: Readonly<Record<string, unknown>> | undefined
  /** 已经重挂并重发过一次了。**只重一次**——挂回来还是同一堵墙就别再转了。 */
  again: boolean
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
    this.send({ prompt, meta: this.options.promptMeta?.(turnId), again: false }, turnId)
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
    this.send({ prompt: [{ type: "text", text: turn.prompt }], meta, again: false }, turnId)
  }

  private send(sent: Sent, turnId: TurnId): void {
    const { state } = this.options
    if (state.acpSession === undefined) {
      this.options.fail(turnId, `${this.options.id} 会话尚未就绪`)
      return
    }
    state.turn = turnId
    this.options.rpc.call("session/prompt", {
      sessionId: state.acpSession,
      prompt: sent.prompt,
      ...(sent.meta === undefined ? {} : { _meta: sent.meta }),
    }).then(
      (result) => this.options.complete(turnId, (result as AcpPromptResult | undefined)?.stopReason),
      (error: unknown) => {
        void this.failed(sent, turnId, error)
      },
    )
  }

  /**
   * 发失败了。**只有「会话睡着了」这一种值得再试一次**，其余原样报出去。
   *
   * 睡着了的表现是每一次发送都撞同一堵墙，而人唯一能做的是反复重发——
   * 那正是应该由程序做掉的事。挂不回来时**两条原因一起说**：光说
   * 「重新挂上失败」会把原来那句 `session/subscribe failed` 藏掉，
   * 而排查要的恰恰是那一句。
   */
  private async failed(sent: Sent, turnId: TurnId, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const revive = this.options.revive
    if (sent.again || revive === undefined || !isAsleep(message)) {
      this.options.fail(turnId, message)
      return
    }
    try {
      await revive()
    } catch (broken: unknown) {
      const why = broken instanceof Error ? broken.message : String(broken)
      this.options.fail(turnId, `${message}（重新挂上也失败了：${why}）`)
      return
    }
    this.send({ ...sent, again: true }, turnId)
  }
}
