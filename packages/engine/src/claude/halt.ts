import type { Query } from "@anthropic-ai/claude-agent-sdk"
import type { TurnId } from "@switchback/protocol"

type Interruptible = Pick<Query, "interrupt">

/** 一轮的停止记账；挂在消息循环的 `TurnRef` 上。 */
export interface HaltState {
  /** 这一轮送进去的消息（那句话与每条插话）的 uuid。中断回执只按 uuid 点名。 */
  sent: Set<string>
  /** 按过停止，回执却说这一轮还有消息会照跑：等它跑起来再停。 */
  turn?: TurnId
  /** 发出去还没回执的中断数；有一个在路上就不再叠一个。 */
  inflight: number
}

/** 消息循环的轮次引用里停止要用的那两样。 */
export interface Haltable {
  current: TurnId | undefined
  halt: HaltState
}

export function createHaltState(): HaltState {
  return { sent: new Set(), inflight: 0 }
}

/** 新的一轮从头记。 */
export function resetHalt(state: HaltState): void {
  state.sent.clear()
  state.turn = undefined
}

/**
 * 停止这一轮。
 *
 * Claude 的中断只打断**正在跑**的那一段；已经送进去、还在排队的消息（插话，或刚出队还没开跑的
 * 这句话本身）照样会跑——它在回执的 `still_queued` 里逐条点名，所以送的每条都带 uuid。
 * 点到的是这一轮送的消息，就记下「这一轮要停」：消息循环再见到这一轮的动静（它跑起来了）
 * 就再中断一次，直到回执不再点名。公开的中断不带 `cancel_queued`，也没有单条撤回，
 * 这是够得着的全部；不报回执的旧 CLI 只能停正在跑的那段（见 README「已知限制」）。
 */
export async function haltTurn(handle: Interruptible | undefined, ref: Haltable): Promise<void> {
  if (handle === undefined) return
  const { halt } = ref
  const turn = ref.current
  halt.inflight += 1
  try {
    const receipt = await handle.interrupt()
    if (turn === undefined || ref.current !== turn) return
    halt.turn = receipt?.still_queued.some((id) => halt.sent.has(id)) === true ? turn : undefined
  } finally {
    halt.inflight -= 1
  }
}

/** 消息循环每收一条调一次：按过停止却还有没停住的，见到它的动静就再停一次。 */
export function haltAgain(handle: Interruptible, ref: Haltable, type: string | undefined): void {
  const { halt } = ref
  if (halt.turn === undefined || halt.turn !== ref.current) return
  // 被打断那一段的 result 只是收尾，不是新的一段跑起来了
  if (halt.inflight > 0 || type === "result") return
  void haltTurn(handle, ref).catch(() => undefined)
}
