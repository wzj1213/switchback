import type { Aside, Item, Lane } from "@omni/protocol"

export type TimelineRow =
  | { kind: "item"; key: string; at: number; item: Item }
  | { kind: "aside"; key: string; at: number; aside: Aside }
  | { kind: "lane"; key: string; at: number; lane: Lane }

/**
 * 把不属于 turn 的侧问 / 旁路插回它出生时所在的位置。
 *
 * item 的原始顺序绝不重排：异步工具结果可能晚到但仍属于原位置，按时间全量 sort 会把正文打乱。
 * extra 自己按出生时刻排，落在第一条不早于它的正文之前；这和桌面端 `group.ts` 的契约相同。
 */
function interpose(rows: readonly TimelineRow[], extra: readonly TimelineRow[]): readonly TimelineRow[] {
  if (extra.length === 0) return rows
  const queue = [...extra].sort((a, b) => a.at - b.at)
  const out: TimelineRow[] = []
  let index = 0
  for (const row of rows) {
    while (queue[index] !== undefined && (queue[index]?.at ?? 0) <= row.at) {
      out.push(queue[index] as TimelineRow)
      index += 1
    }
    out.push(row)
  }
  out.push(...queue.slice(index))
  return out
}

export function timelineOf(
  items: readonly Item[],
  asides: readonly Aside[],
  lanes: readonly Lane[],
): readonly TimelineRow[] {
  const body: TimelineRow[] = items.map((item) => ({ kind: "item", key: item.id, at: item.at, item }))
  const legacy: TimelineRow[] = asides.map((aside, index) => ({
    kind: "aside", key: `aside-${String(aside.at)}-${String(index)}`, at: aside.at, aside,
  }))
  const branches: TimelineRow[] = lanes.map((lane) => ({
    kind: "lane", key: `lane-${lane.id}`, at: lane.at, lane,
  }))
  return interpose(interpose(body, legacy), branches)
}
