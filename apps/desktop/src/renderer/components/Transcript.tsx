import type { Command, Item, Lane, TaskRun, Thread, Turn } from "@omni/protocol"
import { memo, useCallback, useMemo, useState } from "react"
import { foldTurns, groupRows, withAsides, withLanes } from "../group.js"
import { useStickToBottom } from "../useStickToBottom.js"
import { TurnStatus } from "./TurnStatus.js"
import { ArrowDownIcon } from "./icons.js"
import { TranscriptBlank } from "./transcript-blank.js"
import { useApprovalState } from "../use-approval-state.js"
import { RowView, canAsk, canRewind, keyOf, lastMine, retryProps, approvalShortcut } from "./transcript-row.js"
import { useAskSelection } from "../use-ask-selection.js"
import { AskFloat } from "./ask-float.js"

/**
 * 对话正文。
 *
 * 滚动跟随的计数把状态行也算进去——它出现时也该把视图顶到底，
 * 否则一轮刚开始就已经被顶出可视区了。
 */
/**
 * 转录区。**整块 memo**。
 *
 * 六个 props 全都是引用稳定的：`thread` / `items` / `turn` 直接来自 store
 *（同一批增量之间不换对象，空会话那份见 `AppApi.items`），`send` / `onCopy`
 * 是 `useCallback`，`onReuse` 在 `Workspace` 的 `useDraft` 里也是。
 *
 * 挡的是**外壳状态引起的重渲染**：打开设置、开关审核面板、侧栏筛选拿焦点——
 * 这些都会让 `App` 整棵树重跑一遍，而它们和转录区里的内容没有半点关系。
 * 一屏几百条的会话上，那一次白跑正是「点开设置顿一下」里剩下的那部分。
 */
export const Transcript = memo(function Transcript({
  thread,
  items,
  turn,
  tasks,
  thinkingTokens,
  lanes,
  openLane, onOpenLane,
  send,
  onCopy,
  onReuse,
  readOnly,
}: {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  /** 此刻在跑的子 agent。**引擎报了才有**，一个都没有时是空数组。 */
  tasks: readonly TaskRun[]
  thinkingTokens: number | undefined
  /**
   * 这条会话的旁路。**引擎不报就是空数组**（`capabilities.activity === false` 的那三家），
   * 空数组时 `withLanes` 原样返回，一行都不多。
   */
  lanes: readonly Lane[]
  /** 工作台正开着哪条。缺席 = 没有工作台那一档（对比视图）。 */
  openLane?: string | undefined
  onOpenLane?: ((laneId: string) => void) | undefined
  send: (command: Command) => void
  onCopy: (text: string) => void
  /**
   * 把一句话填回输入框。对比视图不给（那边没有输入框）。
   * 第三个参数是「**顺手进侧问模式**」——选中转录区一段话之后那颗「问一句」走这条。
   */
  onReuse?: (text: string, attachments?: readonly string[], aside?: boolean) => void
  /** 对比页只允许阅读、折叠与复制，不执行审批或创建新分支。 */
  readOnly?: boolean
}): React.JSX.Element {
  const { scroller, inner, atBottom, toBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()
  /** 折起来的那几轮。**按会话隔离**靠 `App` 给 `Workspace` 的 key，这里不用自己管 */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const onFold = useCallback((turnId: string) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(turnId)) next.add(turnId)
      return next
    })
  }, [])
  const rows = useMemo(
    // **折叠在前、插旁路在后**：侧问与旁路都不归任何一轮，折起某一轮不该把它们一起折掉
    () => withLanes(withAsides(foldTurns(groupRows(items, turn?.id), folded), thread.asides ?? []), lanes),
    [items, turn?.id, folded, thread.asides, lanes],
  )
  // resolve 必须引用稳定，`ItemView` 的 memo 才不会在每帧流式更新时整屏失效。
  const approval = useApprovalState(items, thread.detached === true ? undefined : turn?.id, send)
  // 选中转录区一段话 → 浮一颗「问一句」。没有输入框的对比视图不给
  const ask = useAskSelection(inner, canAsk(thread, onReuse !== undefined))
  // 「改一改再发」只挂最后一句人话，而且只在能 rewind 时——见 `transcript-row.tsx`
  const retry = { id: useMemo(() => lastMine(rows), [rows]), active: canRewind(thread, turn, readOnly === true) }
  return (
    <div className="transcript" ref={scroller}>
      {items.length === 0 && turn === undefined ? <TranscriptBlank thread={thread} /> : null}
      <div className="transcript__inner" ref={inner}>
        {rows.map((row) => (
          <RowView
            key={keyOf(row)}
            row={row}
            cwd={thread.cwd}
            openLane={openLane} onOpenLane={onOpenLane}
            {...(canRewind(thread, turn, readOnly === true)
              ? { onRewind: (turnId: string) => { send({ type: "thread.rewind", threadId: thread.id, turnId }) } }
              : {})}
            {...retryProps(row, { ...retry, threadId: thread.id, send })}
            folded={row.kind === "turn" && folded.has(row.turnId)}
            onFold={onFold}
            onCopy={onCopy}
            onResolve={approval.resolve}
            approvalTurn={approval.turnId}
            shortcutApproval={approvalShortcut(readOnly === true, approval.shortcut)}
            readOnly={readOnly === true}
            laneLive={thread.detached !== true}
          />
        ))}
        {/* **状态行是对话流的最后一个孩子**，跟着内容滚。它说的是「它在想什么」，
            那是内容，不是状态栏。逃生口（停止）在输入区里，本来就不会滚走 */}
        <TurnStatus thread={thread} turn={turn} items={items} tasks={tasks} thinkingTokens={thinkingTokens} />
      </div>
      {/* 往回翻的时候给一条回去的路。**这才是「逃生口不该滚走」的正确解法**——
          不是把状态行钉住，而是给一个「回到底部」 */}
      <AskFloat pick={ask} onAsk={onReuse} />
      {atBottom ? null : (
        <button type="button" className="tobottom" aria-label="回到底部" onClick={toBottom}>
          <ArrowDownIcon />
        </button>
      )}
    </div>
  )
})
