import { useEffect, useState } from "react"
import type { Command, Thread, Trust } from "@switchback/protocol"
import { cannotRevive } from "@switchback/store"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { REATTACH } from "./Reattach.messages.js"

/**
 * 一条老会话，把它接回引擎。
 *
 * ## 什么时候还用得到这一屏
 *
 * 历史会话平常直接给输入框，发出去宿主先接回来（见 `ThreadInput`）。只剩两种先到这里：
 * 宿主接不回的（给「开一条新的」），和开在远程上限之上的（先降档再接——不降的话那一句会被远程策略挡下）。
 * 上一版对着所有历史会话都只做一件事：把输入框禁掉、写一句「去桌面上点『继续』」——
 * 那等于把这一端做成只读，而它存在的意义正是「人不在电脑前」。
 *
 * ## 三条判据，缺一条就是「点了没反应」
 *
 * 1. **宿主必拒的，压根不给这颗按钮。** 判据和桌面端是同一条（`@switchback/store` 的
 *    `cannotRevive`）：没换家、原来那家又没留下句柄。挑过别家的照样接——由那家接着做；
 *    明知必然失败还摆一颗按钮，是最没道理的一种。
 * 2. **档位高过远程上限的，先切档再接。** 接回来之后每一句话都要过
 *    `RUNS_IN_THREAD` 那道闸，切不下来就是「接上了却说不了话」。
 * 3. **转圈要有尽头。** 失败的路不止一条（引擎起不来、cwd 没了、握手超时），
 *    而它们在宿主那边抛出去之后走的是 `engine.status crashed`。
 *    没有兜底的话，这颗按钮会永远停在「正在接…」——**而那比一开始就报错糟得多**。
 */
const RANK: Readonly<Record<string, number>> = { "read-only": 0, "auto-edit": 1, full: 2 }

/** 等多久算接不上。引擎起进程 + 载上下文通常几秒，25 秒是很松的上界。 */
const GIVE_UP_MS = 25_000

type Text = (typeof REATTACH)[Locale]

/** 还没点时那句话：接回来谁接着做，要不要先降档。 */
function idleWhy(next: string | undefined, lowered: { from: string; to: string } | undefined, m: Text): string {
  const who = next === undefined ? m.resume : m.resumeWith(next)
  const trust = lowered === undefined ? "" : m.lowered(lowered.from, lowered.to)
  return m.detached(who, trust)
}

export function Reattach({
  thread,
  ceiling,
  offline,
  send,
  label,
}: {
  thread: Thread
  /** 远程档位上限（`/api/me` 报的）。 */
  ceiling: string
  offline: boolean
  send: (command: Command) => boolean
  /** 引擎 id → 名字。 */
  label: (id: string) => string
}): React.JSX.Element {
  const m = useMessages(REATTACH)
  const [going, setGoing] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const tooHigh = (RANK[thread.trust] ?? 0) > (RANK[ceiling] ?? 0)
  const hopeless = cannotRevive(thread)
  // 桌面上挑过别家：接回来就由那家接着做（宿主 `revive.ts` 的规矩），这里照实说
  const next = thread.nextEngine !== undefined && thread.nextEngine !== thread.engine ? label(thread.nextEngine) : undefined

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
        <p className="reattach__why">{m.hopeless}</p>
        <button
          className="btn btn--primary reattach__go"
          type="button"
          disabled={offline}
          onClick={() => {
            send({ type: "thread.create", cwd: thread.cwd, engine: thread.engine, trust: ceiling as Trust })
          }}
        >
          {offline ? m.waiting : m.fresh}
        </button>
      </div>
    )
  }

  if (going !== undefined) {
    return (
      <div className="reattach">
        <p className="reattach__why">{m.going}</p>
        <p className="reattach__hint">{m.goingHint}</p>
      </div>
    )
  }

  return (
    <div className="reattach">
      <p className="reattach__why">{failed ? m.failed : idleWhy(next, tooHigh ? { from: thread.trust, to: ceiling } : undefined, m)}</p>
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
        {offline ? m.waiting : failed ? m.retry : m.go}
      </button>
    </div>
  )
}
