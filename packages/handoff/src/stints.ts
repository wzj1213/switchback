import type { Event, Item, Thread } from "@omni/protocol"

/** 一段连续由同一家引擎跑的轮次。 */
export interface Stint {
  engine: string
  /** 这一段第一条 / 最后一条记录的时刻（毫秒）。 */
  from: number
  to: number
  /** 这一段跑了几轮。 */
  turns: number
}

/**
 * 某个时刻归哪家引擎：最后一个 `startedAt` 不晚于它的分段。
 * 比第一段还早（分段是跑完第一轮才落的）就归第一段；一段都没有就归当前引擎。
 */
export function engineAt(thread: Thread, at: number): string {
  const segments = thread.segments ?? []
  const hit = segments.findLast((segment) => segment.startedAt <= at) ?? segments[0]
  return hit?.engine ?? thread.engine
}

/** 轮次 id → 开这一轮的引擎。 */
export type TurnEngines = ReadonlyMap<string, string>

/**
 * 从事件流里取每一轮是哪家开的：`turn.started` 上记着，是当时的事实。
 *
 * 比按分段开始时间推断准：分段要等那一家有了句柄才落，有的引擎第一轮跑完才报句柄，
 * 按时间推断会把换家后的第一轮算到前一家头上。
 */
export function turnEnginesOf(events: readonly Event[]): TurnEngines {
  const out = new Map<string, string>()
  for (const event of events) if (event.type === "turn.started") out.set(event.turn.id, event.turn.engine)
  return out
}

export interface TurnSlice {
  turnId: string
  items: readonly Item[]
}

/** 按出现顺序把条目分到各轮；每轮记下第一条的时刻，用来判断归哪家。 */
export function turnsOf(items: readonly Item[]): readonly TurnSlice[] {
  const order: string[] = []
  const byTurn = new Map<string, Item[]>()
  for (const item of items) {
    const own = byTurn.get(item.turnId)
    if (own === undefined) {
      order.push(item.turnId)
      byTurn.set(item.turnId, [item])
    } else own.push(item)
  }
  return order.map((turnId) => ({ turnId, items: byTurn.get(turnId) ?? [] }))
}

/** 这一轮归哪家：有 `turn.started` 的记录就认它，没有才按时间推断。 */
export function ownerOf(thread: Thread, turn: TurnSlice, engines?: TurnEngines): string {
  const known = engines?.get(turn.turnId)
  if (known !== undefined) return known
  const first = turn.items[0]
  return first === undefined ? thread.engine : engineAt(thread, first.at)
}

/** 整条会话按引擎切成几段：同一家连着跑的轮次并成一段。 */
export function stintsOf(thread: Thread, items: readonly Item[], engines?: TurnEngines): readonly Stint[] {
  const out: Stint[] = []
  for (const turn of turnsOf(items)) {
    const first = turn.items[0]
    const last = turn.items[turn.items.length - 1]
    if (first === undefined || last === undefined) continue
    const engine = ownerOf(thread, turn, engines)
    const open = out[out.length - 1]
    if (open?.engine === engine) {
      open.to = last.at
      open.turns += 1
    } else out.push({ engine, from: first.at, to: last.at, turns: 1 })
  }
  return out
}

/** ISO 时间（UTC，到秒）。各家原始记录的时间戳也是这种写法，拿去 grep 对得上。 */
export function isoAt(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19)}Z`
}
