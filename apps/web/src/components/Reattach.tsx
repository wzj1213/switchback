import { useEffect, useState } from "react"
import type { Command, Thread, Trust } from "@omni/protocol"

/**
 * 一条老会话，把它接回引擎。
 *
 * ## 为什么这一屏必须有
 *
 * **手机上绝大多数会话都是 detached 的**（宿主只让少数几条同时活着）。
 * 上一版对着它们只做了一件事：把输入框禁掉、写一句「去桌面上点『继续』」——
 * 那等于把这一端做成只读，而它存在的意义正是「人不在电脑前」。
 *
 * ## 三条判据，缺一条就是「点了没反应」
 *
 * 1. **没有引擎句柄的，压根不给这颗按钮。** `resume` 的硬前提就是它
 *    （`host/session.ts`：没句柄就抛「只能新建会话继续」），而句柄就在
 *    `Thread` 上、手机手上一直有。明知必然失败还摆一颗按钮，是最没道理的一种。
 * 2. **档位高过远程上限的，先切档再接。** 接回来之后每一句话都要过
 *    `RUNS_IN_THREAD` 那道闸，切不下来就是「接上了却说不了话」。
 * 3. **转圈要有尽头。** 失败的路不止一条（引擎起不来、cwd 没了、握手超时），
 *    而它们在宿主那边抛出去之后走的是 `engine.status crashed`。
 *    没有兜底的话，这颗按钮会永远停在「正在接…」——**而那比一开始就报错糟得多**。
 */
const RANK: Readonly<Record<string, number>> = { "read-only": 0, "auto-edit": 1, full: 2 }

/** 等多久算接不上。引擎起进程 + 载上下文通常几秒，25 秒是很松的上界。 */
const GIVE_UP_MS = 25_000

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
  const [going, setGoing] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const tooHigh = (RANK[thread.trust] ?? 0) > (RANK[ceiling] ?? 0)
  const hopeless = thread.engineHandle === undefined

  // **看门狗。** 成功那一路不需要它（`detached` 一翻假，这个组件连同状态一起卸掉）；
  // 它治的是失败那一路——宿主抛错走的是另一条通道，这里收不到，
  // 没有它的话界面就永远停在「正在接…」
  useEffect(() => {
    if (going === undefined) return undefined
    const timer = setTimeout(() => {
      setGoing(undefined)
      setFailed(true)
    }, GIVE_UP_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [going])

  // 换了一条会话就把状态作废：不然你在 A 上点过之后，进 B 看到的是 A 的转圈
  useEffect(() => {
    setGoing(undefined)
    setFailed(false)
  }, [thread.id])

  if (hopeless) {
    // **说实话 + 给一个真能干的动作。** 人要的是「在这个项目里接着干」，
    // 不是「非得是这一条」——所以直接把新建摆出来，目录和引擎从这条会话上抄
    return (
      <div className="reattach">
        <p className="reattach__why">这条会话没留下引擎侧的句柄（旧版本记录），接不回来了。</p>
        <button
          className="btn btn--primary reattach__go"
          type="button"
          disabled={offline}
          onClick={() => {
            send({ type: "thread.create", cwd: thread.cwd, engine: thread.engine, trust: ceiling as Trust })
          }}
        >
          {offline ? "等重连…" : "在同一个项目里开一条新的"}
        </button>
      </div>
    )
  }

  if (going !== undefined) {
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
        {failed
          ? "没接上。可能是引擎起不来，或者那个目录不在了——再试一次，或者去桌面上看看。"
          : `这条会话现在没接引擎。接回来就能接着说。${tooHigh ? `它开在「${thread.trust}」档，高过远程上限——接回来会先切到「${ceiling}」。` : ""}`}
      </p>
      <button
        className="btn btn--primary reattach__go"
        type="button"
        disabled={offline}
        onClick={() => {
          // **先切档再接。** 反过来的话中间那一瞬间它是活着的完全档会话，
          // 而那正是远程上限要挡的东西。宿主那侧对 detached 的会话也认这条命令
          //（见 `host/session.ts` 的 `setTrust`）
          if (tooHigh) send({ type: "thread.setTrust", threadId: thread.id, trust: ceiling as Trust })
          const sent = send({ type: "thread.resume", threadId: thread.id })
          // 发不出去就别转圈：断线时 `send` 返回 false，转圈会让人一直等一件没发生的事
          if (sent) {
            setFailed(false)
            setGoing(thread.id)
          }
        }}
      >
        {offline ? "等重连…" : failed ? "再试一次" : "接回来，继续说"}
      </button>
    </div>
  )
}
