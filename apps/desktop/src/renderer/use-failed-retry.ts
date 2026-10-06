import { useMemo } from "react"
import type { Command, Item, Thread, Turn } from "@switchback/protocol"
import { retryTarget, type RetryTarget } from "./error-plan.js"

/**
 * 终态报错卡上那颗「再试一次」：把失败那一轮你说的话原样再发一次。
 *
 * **只在此刻真能发的时候给**：对比页只读、会话还是重启前的历史（要先「继续」）、
 * 上一轮还在跑——这几种都不给。给一颗点了没反应、或者点了排进队列等半天的按钮，比没有更糟。
 * 发的就是输入框「发送」那条命令；换一家再试走输入框里的引擎选择器，不在这张卡上另开一条路。
 */
export function useFailedRetry(
  items: readonly Item[],
  on: { thread: Thread; turn: Turn | undefined; readOnly: boolean; send: (command: Command) => void },
): { target: RetryTarget; run: (target: RetryTarget) => void } | undefined {
  const { thread, turn, readOnly, send } = on
  const target = useMemo(() => retryTarget(items), [items])
  const open = !readOnly && turn === undefined && thread.detached !== true &&
    (thread.status === "idle" || thread.status === "failed")
  return useMemo(() => {
    if (!open || target === undefined) return undefined
    return {
      target,
      run: (next: RetryTarget) => {
        send({
          type: "thread.prompt",
          threadId: thread.id,
          text: next.text,
          ...(next.attachments === undefined ? {} : { attachments: next.attachments }),
        })
      },
    }
  }, [open, target, send, thread.id])
}
