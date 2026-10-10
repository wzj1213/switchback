import type { Event, ThreadId, Trust } from "@switchback/protocol"

/**
 * 每条会话（含背后没有进程的历史会话）记录里开在哪一档。
 *
 * 远程策略要它：手机往一条会话里发话、分叉、重来之前，得知道那条会话开在哪一档，
 * 高过远程上限的就挡（见 `remote/policy.ts`）。宿主只答得出活会话的档位，
 * 历史会话的在 journal 里——所以在事件出口与全量重建时顺手记一份，查的时候不用读盘
 *（策略是同步判的）。
 */
export interface ThreadTrust {
  /** 事件出口上每一条都过一遍：出生、更新记档位，删掉就忘。 */
  note: (event: Event) => void
  /** 全量重建时读到的一条会话的历史。 */
  noteHistory: (threadId: ThreadId, events: readonly Event[]) => void
  of: (threadId: ThreadId) => Trust | undefined
}

export function createThreadTrust(): ThreadTrust {
  const known = new Map<ThreadId, Trust>()
  const note = (event: Event): void => {
    if (event.type === "thread.started" || event.type === "thread.updated") known.set(event.thread.id, event.thread.trust)
    else if (event.type === "thread.removed") known.delete(event.threadId)
  }
  return {
    note,
    noteHistory: (threadId, events) => {
      const last = events.findLast((event) => event.type === "thread.started" || event.type === "thread.updated")
      if (last?.type === "thread.started" || last?.type === "thread.updated") known.set(threadId, last.thread.trust)
    },
    of: (threadId) => known.get(threadId),
  }
}
