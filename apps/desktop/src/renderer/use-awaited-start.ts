import { useCallback, useEffect, useRef } from "react"
import type { ThreadId } from "@switchback/protocol"
import type { Notice } from "@switchback/store"

interface Awaiting {
  /** 点下去那一刻的 `lastStarted` 序号；等一个比它大的（为什么是序号见 `useApp`）。 */
  seq: number
  /** 分叉 / 重来的源会话。新建没有源。 */
  from?: ThreadId
  at: number
}

/**
 * 等下一条新出现的会话，到了就跳过去：「+」、分叉、重来都走这里。
 *
 * 分叉 / 重来可能在新会话出现之前就被宿主拒掉（这家不支持、那句之前没有原生轮次……），
 * 那时唯一的回音是源会话上的一条横幅——看到它就不等了。不然记号一直挂着，
 * 之后随便哪条会话冒出来（手机端新建的、接回来的）都会把你拽过去。
 */
export function useAwaitedStart(
  lastStarted: { id: ThreadId; seq: number } | undefined,
  notices: readonly Notice[],
  select: (id: ThreadId) => void,
): (from?: ThreadId) => void {
  const awaited = useRef<Awaiting | undefined>(undefined)
  const latest = useRef(lastStarted)
  latest.current = lastStarted
  useEffect(() => {
    const waiting = awaited.current
    if (waiting === undefined || lastStarted === undefined || lastStarted.seq <= waiting.seq) return
    awaited.current = undefined
    select(lastStarted.id)
  }, [lastStarted, select])
  useEffect(() => {
    const waiting = awaited.current
    if (waiting?.from === undefined) return
    if (notices.some((notice) => notice.threadId === waiting.from && notice.at >= waiting.at)) awaited.current = undefined
  }, [notices])
  return useCallback((from?: ThreadId) => {
    awaited.current = { seq: latest.current?.seq ?? 0, at: Date.now(), ...(from === undefined ? {} : { from }) }
  }, [])
}
