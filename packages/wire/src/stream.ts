import type { Event } from "@omni/protocol"
import type { Replay, Sealed } from "./types.js"

/**
 * 接收端的游标与补洞。
 *
 * ## 为什么是纯函数
 *
 * 这是整条链路上唯一一段「顺序错一步，界面就安静地显示错误内容」的逻辑。
 * 它必须能脱离 React、脱离传输单独测——所以做成纯函数：进状态与输入，
 * 出新状态和「要应用什么、要补什么」。
 *
 * ## 三种输入，一条规则
 *
 * | 输入 | 什么时候 |
 * | --- | --- |
 * | `replayed` | （重）连接，宿主发来全量 + `resumeAt` |
 * | `received` | 常态增量，带序号 |
 * | `resynced` | 我们发现漏了，宿主补回来的那一段 |
 *
 * 规则只有一条：**只应用连得上的**。连不上就攒着并去补，绝不跳过缺口硬着头皮往下应用——
 * 漏一条 `item.started`，后面所有对这条 item 的 delta 全都无处可去；
 * 漏一条 `turn.completed`，界面就永远停在「进行中」。而这些都不会报错。
 */

export interface Stream {
  /** 收到的最后一个序号。`undefined` = 还没收到全量，什么都不能应用。 */
  lastSeq: number | undefined
  /**
   * 手上这份基线属于宿主的哪一次运行。**去要补发时必须一起报**——
   * 只报序号的话，宿主分不出这个游标是不是上一次运行留下的（见 `Replay.epoch`）。
   */
  epoch: string | undefined
  /** 连不上的增量先攒在这，按序号排好、去过重。 */
  pending: readonly Sealed[]
  /** 正在等补发。这期间来的增量继续攒，不应用。 */
  catching: boolean
}

export const initialStream: Stream = {
  lastSeq: undefined,
  epoch: undefined,
  pending: [],
  catching: false,
}

export interface Step {
  stream: Stream
  /** 交给归约器的事件，已经按序排好。 */
  apply: readonly Event[]
  /** 有值就去问宿主要这个序号之后的。 */
  resyncFrom?: number
}

function merge(pending: readonly Sealed[], incoming: readonly Sealed[]): Sealed[] {
  const bySeq = new Map<number, Sealed>()
  for (const s of [...pending, ...incoming]) bySeq.set(s.seq, s)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * 从 `lastSeq` 开始能连多远就走多远。
 *
 * 走不动（下一个不是 `lastSeq + 1`）就停下来去补。已经见过的（`seq <= lastSeq`）
 * 直接丢——重复应用比丢弃危险，`item.started` 应用两次会长出两条一样的 item。
 */
function drain(lastSeq: number, epoch: string | undefined, queue: readonly Sealed[]): Step {
  const apply: Event[] = []
  let cursor = lastSeq
  let index = 0
  for (; index < queue.length; index += 1) {
    const entry = queue[index]
    if (entry === undefined) break
    if (entry.seq <= cursor) continue
    if (entry.seq !== cursor + 1) break
    apply.push(entry.event)
    cursor = entry.seq
  }
  const rest = queue.slice(index).filter((s) => s.seq > cursor)
  if (rest.length === 0) {
    return { stream: { lastSeq: cursor, epoch, pending: [], catching: false }, apply }
  }
  return {
    stream: { lastSeq: cursor, epoch, pending: rest, catching: true },
    apply,
    resyncFrom: cursor,
  }
}

/**
 * 全量到了。
 *
 * `resumeAt` 之前的增量一律丢：它们要么已经在这份全量里，要么发生在
 * 我们还没订阅的时候（也就在全量里）。这个判据由宿主保证——
 * 它是**读完历史之后**才取的 `resumeAt`。
 */
export function replayed(stream: Stream, replay: Replay): Step {
  const queue = stream.pending.filter((s) => s.seq > replay.resumeAt)
  const next = drain(replay.resumeAt, replay.epoch, queue)
  return { ...next, apply: [...replay.events, ...next.apply] }
}

/** 常态增量。还没收到全量、或正在补发时先攒着。 */
export function received(stream: Stream, sealed: readonly Sealed[]): Step {
  if (stream.lastSeq === undefined || stream.catching) {
    return { stream: { ...stream, pending: merge(stream.pending, sealed) }, apply: [] }
  }
  return drain(stream.lastSeq, stream.epoch, merge(stream.pending, sealed))
}

/** 补发回来了。 */
export function resynced(stream: Stream, sealed: readonly Sealed[]): Step {
  if (stream.lastSeq === undefined) {
    return { stream: { ...stream, pending: merge(stream.pending, sealed) }, apply: [] }
  }
  return drain(stream.lastSeq, stream.epoch, merge(stream.pending, sealed))
}

/**
 * 宿主说补不了（缺口比它的保留缓冲还老）。
 *
 * 回到「还没收到全量」的状态并**把攒着的全部丢掉**——它们连不上任何东西了。
 * 调用方接下来要重新握手，好触发一次全量重建。
 * 留着旧的 pending 只会在下一次全量之后被 `resumeAt` 判据滤掉，白占内存。
 */
export function reset(): Stream {
  return initialStream
}
