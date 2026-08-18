import { useCallback, useRef } from "react"
import type { Command } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { learnFrom } from "./newThreadPrefs.js"
import type { LastUsed, Settings } from "../shared/settings.js"

/**
 * 命令的出口，顺路记下**下次新会话开成什么样**。
 *
 * 挂在发消息这一刻，是因为「挑好了引擎和模型，然后真的发出去」才是一次表态；
 * 光点开下拉看看不算——那可能只是在翻有哪些模型。剩下那半条规则
 *（同一条会话第二次发就不再记）在 `learnFrom` 里，两边共用同一份判断。
 *
 * 包在这里而不是输入框里：排队补发、`/` 面板、快捷键都从这条路出去，
 * 挂在输入框上会漏掉其余几条。
 *
 * ## 为什么它必须**引用稳定**（这才是单独一个文件的原因）
 *
 * 这个函数是 `ItemView` 那个 memo 的链根：`Workspace` 把它交给 `Transcript`，
 * 那边的 `onResolve` 依赖它（`useCallback`），而 `ItemView` 的 memo 依赖 `onResolve`。
 * 它原来是 `useApp` 里的一个行内箭头——每次渲染换一个身份，于是
 * **那个 memo 一次都没生效过**。它挡的正是 `ItemView` 注释里量过的那件事：
 * 流式期间每 16ms 把已经定稿的每条消息连同 markdown 重渲一遍，20 条消息一帧 30ms。
 * 功能全对，只是每帧白干——这类静默失效正是这个仓库最怕的东西。
 *
 * ## 为什么值走 ref
 *
 * 它要读 `rows` 和 `lastUsed`，而 `rows` 是每次渲染现算的数组、
 * `state` 每来一批增量就换一个——写进依赖数组等于没有 `useCallback`。
 * 所以身份只跟着 `base` 走，值从 ref 里取。
 *
 * **在渲染里赋值**（不是 effect）：effect 要等提交之后才跑，那期间发出去的话
 * 会用上一帧的 `rows`——而「上一帧的 rows」里那条会话的模型，可能正是用户
 * 刚改完、马上就发的那个。这里赋的是当前渲染算出来的值，重复执行结果相同。
 */
export interface SendContext {
  /** 全部会话。要从里面找出这条命令发给谁。 */
  rows: readonly ThreadRow[]
  lastUsed: LastUsed
  patch: (next: Partial<Settings>) => void
  /**
   * 「我刚要了一条新会话，等它出来就跳过去」。
   *
   * **分叉和重来必须跳**：它们生出来的那条现在是临时的（不进侧栏，见
   * `Thread.provisional`），不跳的话用户点完什么都看不到——界面上没有那一行，
   * 主区还停在原来那条，看起来就是「点了没反应」。
   */
  onBranch: () => void
}

export function useSend(base: (command: Command) => void, context: SendContext): (command: Command) => void {
  const latest = useRef(context)
  latest.current = context
  return useCallback(
    (command: Command): void => {
      if (command.type === "thread.prompt") {
        const { rows, lastUsed, patch } = latest.current
        const target = rows.find((r) => r.thread.id === command.threadId)?.thread
        const next = target === undefined ? undefined : learnFrom(lastUsed, target)
        if (next !== undefined) patch({ lastUsed: next })
      }
      // 分叉 / 重来会生出一条新会话，等它到了就跳过去（理由见 `SendContext.onBranch`）
      if (command.type === "thread.fork" || command.type === "thread.rewind") latest.current.onBranch()
      base(command)
    },
    [base],
  )
}
