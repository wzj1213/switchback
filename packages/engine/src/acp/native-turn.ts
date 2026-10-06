import type { TurnId } from "@switchback/protocol"
import type { NativeTurnStart } from "../contract.js"
import type { ForeignTurn } from "./caps.js"

interface ActiveTurn {
  key: string
  turnId: TurnId
}

interface NativeTurnQueueOptions {
  begin: ((turn: NativeTurnStart) => TurnId | undefined) | undefined
  send: (turn: ForeignTurn, turnId: TurnId) => void
  now: () => number
}

/**
 * ACP 私有主动轮的串行队列。
 *
 * Grok 的定时任务可以在普通轮尚未结束时触发；首方客户端会排队，不能因宿主正忙就丢掉。
 * 去重只覆盖“仍在排队或运行”的同一触发，收工后同一个循环任务下次仍能再次进入。
 */
export class AcpNativeTurnQueue {
  private readonly pending: ForeignTurn[] = []
  private active: ActiveTurn | undefined

  constructor(private readonly options: NativeTurnQueueOptions) {}

  enqueue(turn: ForeignTurn): boolean {
    if (this.active?.key === turn.key || this.pending.some((item) => item.key === turn.key))
      return false
    this.pending.push(turn)
    this.drain()
    return true
  }

  /** 普通宿主轮和主动轮收工都来敲一次；迟到的旧回包不能清掉正在跑的新主动轮。 */
  settled(turnId: TurnId): void {
    if (this.active?.turnId === turnId) this.active = undefined
    this.drain()
  }

  /** 宿主刚开始一轮时重试一次此前因竞态未能认领的主动轮。 */
  poke(): void {
    this.drain()
  }

  private drain(): void {
    const next = this.pending[0]
    if (next === undefined || this.active !== undefined) return
    const { origin } = next
    const turnId = this.options.begin?.({
      at: this.options.now(),
      prompt: next.prompt,
      ...(origin === undefined ? {} : { origin }),
    })
    if (turnId === undefined) return
    this.pending.shift()
    this.active = { key: next.key, turnId }
    this.options.send(next, turnId)
  }
}
