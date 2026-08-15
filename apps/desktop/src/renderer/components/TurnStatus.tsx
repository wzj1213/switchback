import { useEffect, useState } from "react"
import type { Item, Thread, Turn } from "@omni/protocol"
import { Shimmer } from "./Shimmer.js"
import { elapsed, statusLabel } from "../status.js"

/** 计时器只需秒级精度，1s 一跳。 */
const TICK_MS = 1000

/**
 * 一轮跑起来之后 transcript 底部的那行状态。
 *
 * 在这之前，界面在等待期间**什么都不显示**——工具行冒出来之前那十几秒，
 * 你分不清是它在想、还是它已经挂了。这行字加一个计时器就把这个洞补上了：
 * 说得出在干什么，也看得见花了多久。
 */
export function TurnStatus({
  thread,
  turn,
  items,
  onInterrupt,
}: {
  thread: Thread
  turn: Turn | undefined
  items: readonly Item[]
  onInterrupt: () => void
}): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  const running = turn !== undefined

  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [running])

  const label = statusLabel(thread, items)
  if (turn === undefined || label === undefined) return null
  return (
    <div className="turnstatus" role="status" aria-live="polite">
      <Shimmer text={label} />
      <span className="turnstatus__clock">{elapsed(turn.startedAt, now)}</span>
      <button className="turnstatus__stop" type="button" onClick={onInterrupt}>
        停止
      </button>
    </div>
  )
}
