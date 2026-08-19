import { useState } from "react"
import type { Command, Thread, Trust } from "@omni/protocol"

/**
 * 一条老会话，把它接回引擎。
 *
 * ## 为什么这一屏原来没有
 *
 * 上一版对着 detached 的会话只做了一件事：把输入框禁掉，写一句
 * 「这条会话没接引擎，去桌面上点『继续』」。而**手机上绝大多数会话都是 detached 的**
 *（宿主只保留少数几条活的），于是这一端实际上是**只读的**——
 * 用户原话「老会话也能继续 work」说的就是这个。
 *
 * `thread.resume` 这条命令一直存在，远程也一直允许发（`remote/policy.ts` 的白名单里），
 * 只是界面上没有入口。
 *
 * ## 档位这一关要在点之前说清楚
 *
 * 远程有档位上限。一条开在「完全」档的老会话，resume 本身不会被拒
 *（服务端查的是**活着的**会话的档位，而它此刻不活），
 * 但接回来之后每一句 `thread.prompt` 都会被拒——**你接上了却说不了话**。
 *
 * 所以这里在点之前就判：档位高过上限时，把「先切到上限再接」摆成一个明说的动作，
 * 而不是让人点一下、成功了、然后发现打不了字。切低是允许的（`policy.ts`）。
 */
const RANK: Readonly<Record<string, number>> = { "read-only": 0, "auto-edit": 1, full: 2 }

export function Reattach({
  thread,
  ceiling,
  offline,
  send,
}: {
  thread: Thread
  /** 远程档位上限（`/api/me` 报的）。 */
  ceiling: string
  offline: boolean
  send: (command: Command) => boolean
}): React.JSX.Element {
  const [going, setGoing] = useState(false)
  const tooHigh = (RANK[thread.trust] ?? 0) > (RANK[ceiling] ?? 0)

  const go = (): void => {
    // **先切档再接。** 反过来的话中间那一瞬间它是活着的完全档会话，
    // 而那正是远程上限要挡的东西
    if (tooHigh) send({ type: "thread.setTrust", threadId: thread.id, trust: ceiling as Trust })
    const sent = send({ type: "thread.resume", threadId: thread.id })
    // 发不出去就别转圈：断线时 `send` 返回 false，转圈会让人一直等一件没发生的事
    if (sent) setGoing(true)
  }

  if (going) {
    return (
      <div className="reattach">
        <p className="reattach__why">正在把它接回引擎…</p>
        <p className="reattach__hint">引擎要重新起一个进程并载入上下文，通常几秒。</p>
      </div>
    )
  }

  return (
    <div className="reattach">
      <p className="reattach__why">
        这条会话现在没接引擎。接回来就能接着说。
        {tooHigh ? `它开在「${thread.trust}」档，高过远程上限——接回来会先切到「${ceiling}」。` : ""}
      </p>
      <button className="btn btn--primary reattach__go" type="button" disabled={offline} onClick={go}>
        {offline ? "等重连…" : "接回来，继续说"}
      </button>
    </div>
  )
}
