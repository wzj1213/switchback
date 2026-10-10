import { useMemo, useState } from "react"
import type { Command, Item, Thread, Turn } from "@switchback/protocol"
import { retryTarget, type RetryTarget } from "./error-plan.js"
import { cannotRevive } from "@switchback/store"

/**
 * 终态报错卡上那颗「再试一次」：把失败那一轮你说的话原样再发一次。
 *
 * **只在此刻真能发的时候给**：对比页只读、历史会话接不回来（没留句柄，见 `history-note.ts`）、
 * 上一轮还在跑——这几种都不给。给一颗点了没反应、或者点了排进队列等半天的按钮，比没有更糟。
 * 接得回来的历史会话照给：发出去宿主先接回引擎，和输入框发送是同一条命令。
 * 发的就是输入框「发送」那条命令；换一家再试走输入框里的引擎选择器，不在这张卡上另开一条路。
 */
export function useFailedRetry(
  items: readonly Item[],
  on: { thread: Thread; turn: Turn | undefined; readOnly: boolean; send: (command: Command) => void },
): { target: RetryTarget; run: (target: RetryTarget) => void } | undefined {
  const { thread, turn, readOnly, send } = on
  const target = useMemo(() => retryTarget(items), [items])
  // **点过就收起来，直到现场变了。** 开轮前要先做完工作树快照，那几百毫秒到几秒里会话还是
  // idle、按钮还在；「没反应再点一下」的第二下会在宿主排进队列，第一轮收工后同一句再发一遍
  const moment = `${target?.errorId ?? ""}|${thread.status}|${turn?.id ?? ""}`
  const [pressed, setPressed] = useState<string | undefined>(undefined)
  const open = !readOnly && turn === undefined && !cannotRevive(thread) && pressed !== moment &&
    (thread.status === "idle" || thread.status === "failed")
  return useMemo(() => {
    if (!open || target === undefined) return undefined
    return {
      target,
      run: (next: RetryTarget) => {
        setPressed(moment)
        send({
          type: "thread.prompt",
          threadId: thread.id,
          text: next.text,
          ...(next.attachments === undefined ? {} : { attachments: next.attachments }),
        })
      },
    }
  }, [open, target, send, thread.id, moment])
}
