import type { Command, EngineInfo, Item, TaskRun, Thread, Turn, TurnId, TurnPace } from "@switchback/protocol"
import { memo, useMemo } from "react"
import { useStickToBottom } from "../useStickToBottom.js"
import { TurnStatus, type Reconnecting } from "./TurnStatus.js"
import { ToBottomIcon } from "./icons.js"
import { TranscriptBlank } from "./transcript-blank.js"
import { useApprovalState } from "../use-approval-state.js"
import { RowView, canAsk, canRewind, keyOf, answerActs, lastMine, retryProps, errorProps, approvalShortcut } from "./transcript-row.js"
import { planErrors } from "../error-plan.js"
import { useFailedRetry } from "../use-failed-retry.js"
import { useAskSelection } from "../use-ask-selection.js"
import { AskFloat } from "./ask-float.js"
import { TranscriptNavigation } from "./transcript-navigation.js"
import { navPointsOf } from "../transcript-rail.js"
import { engineStints } from "../engine-mark.js"
import { FileLinkScope } from "./message-link.js"
import { useProgressiveRows } from "../use-progressive-rows.js"
import { useTranscriptRows } from "../use-transcript-rows.js"
import { useBody } from "../remote/use-body.js"

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
  engines,
  thinkingTokens,
  reconnecting,
  onReveal,
  send,
  onCopy,
  onReuse,
  readOnly,
  full,
  paces,
}: {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  /** 此刻在跑的子 agent。**引擎报了才有**，一个都没有时是空数组。 */
  tasks: readonly TaskRun[]
  /** 引擎清单：换手那条分界要把 id 翻成人话。引用稳定，不破 memo。 */
  engines: readonly EngineInfo[]
  thinkingTokens: number | undefined
  /** 实时连接正断着、在自己接回来。对比页不给。 */
  reconnecting?: Reconnecting | undefined
  onReveal?: ((path: string) => void) | undefined
  send: (command: Command) => void
  onCopy: (text: string) => void
  /**
   * 把一句话填回输入框。对比视图不给（那边没有输入框）。
   * 第三个参数是「**顺手进侧问模式**」——选中转录区一段话之后那颗「问一句」走这条。
   */
  onReuse?: (text: string, attachments?: readonly string[], aside?: boolean) => void
  /** 对比页只允许阅读、折叠与复制，不执行审批或创建新分支。 */
  readOnly?: boolean
  /** 会话内查找开着：整段历史必须都在 DOM 里，原生查找才数得全（见 `useProgressiveRows`）。 */
  full?: boolean
  /** 每一轮的出字节奏（store 的 `pacesOf`，引用稳定）。分界线上印；不给就不印。 */
  paces?: Readonly<Record<TurnId, TurnPace>> | undefined
}): React.JSX.Element {
  const { scroller, inner, atBottom, toBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()
  const { rows, folded, onFold } = useTranscriptRows(items, turn, thread, paces)
  // resolve 必须引用稳定，`ItemView` 的 memo 才不会在每帧流式更新时整屏失效。
  const approval = useApprovalState(items, thread.detached === true ? undefined : turn?.id, send)
  // 选中转录区一段话 → 浮一颗「问一句」。没有输入框的对比视图不给
  const ask = useAskSelection(inner, canAsk(thread, onReuse !== undefined))
  // 「改一改再发」只挂最后一句人话，而且只在能 rewind 时——见 `transcript-row.tsx`
  const retry = { id: useMemo(() => lastMine(rows), [rows]), active: canRewind(thread, turn, readOnly === true) }
  // 那排动作每轮只挂最后一条回答。**每条都挂的那一版连间距都被它带偏了**，见 `transcript-row.tsx`
  const acts = useMemo(() => answerActs(rows, turn?.id), [rows, turn?.id])
  // 左边那条导航：一格 = 你问的一次（`navPointsOf` 定的谁算一格），颜色 = 那一问归谁跑
  const stints = useMemo(() => engineStints(thread.segments), [thread.segments])
  const points = useMemo(() => navPointsOf(rows, stints), [rows, stints])
  // 报错按它在这一轮里的位置画：正在重试、已经过去，还是并进后面那张终态卡（见 `error-plan.ts`）
  const errors = useMemo(() => planErrors(items, turn?.id), [items, turn?.id])
  const again = useFailedRetry(items, { thread, turn, readOnly: readOnly === true, send })
  // 长会话先挂末尾、其余空闲时补齐；上面这些派生仍按整段历史算
  const shown = useProgressiveRows(rows, full === true)
  // 远程窗口：正文还在路上 / 只带了尾巴。本机窗口恒为否（`remote/use-body.ts`）
  const body = useBody(thread.id)
  return (
    <div
      className="transcript"
      ref={scroller}
      role="region"
      aria-label={`对话记录：${thread.title}`}
      tabIndex={0}
    >
      <TranscriptNavigation scroller={scroller} inner={inner} points={points} engines={engines} />
      {items.length === 0 && turn === undefined ? <TranscriptBlank thread={thread} pending={body.pending} /> : null}
      {body.trimmed ? (
        <p className="transcript__trimmed">更早的内容没有加载：这条会话太长，远程只带了后面这一段。完整记录在那台机器上。</p>
      ) : null}
      <FileLinkScope threadId={thread.id} cwd={thread.cwd}>
      <div className="transcript__inner" ref={inner}>
        {shown.map((row) => (
          <RowView
            key={keyOf(row)}
            row={row}
            threadId={thread.id}
            cwd={thread.cwd}
            engines={engines}
            acts={row.kind === "item" && acts.has(row.item.id)}
            onReveal={onReveal}
            {...(canRewind(thread, turn, readOnly === true)
              ? { onRewind: (turnId: string) => { send({ type: "thread.rewind", threadId: thread.id, turnId }) } }
              : {})}
            {...retryProps(row, { ...retry, threadId: thread.id, send })}
            {...errorProps(row, errors, again)}
            folded={row.kind === "turn" && folded(row.turnId)}
            onFold={onFold}
            onCopy={onCopy}
            onResolve={approval.resolve}
            approvalTurn={approval.turnId}
            shortcutApproval={approvalShortcut(readOnly === true, approval.shortcut)}
            readOnly={readOnly === true}
          />
        ))}
        {/* **状态行是对话流的最后一个孩子**，跟着内容滚。它说的是「它在想什么」，
            那是内容，不是状态栏。逃生口（停止）在输入区里，本来就不会滚走 */}
        <TurnStatus thread={thread} turn={turn} items={items} tasks={tasks} thinkingTokens={thinkingTokens} reconnecting={reconnecting} />
      </div>
      </FileLinkScope>
      {/* 往回翻的时候给一条回去的路。**这才是「逃生口不该滚走」的正确解法**——
          不是把状态行钉住，而是给一个「回到底部」 */}
      <AskFloat pick={ask} onAsk={onReuse} />
      {atBottom ? null : (
        <button type="button" className="tobottom" aria-label="回到底部" data-tip="回到底部" onClick={toBottom}>
          <ToBottomIcon />
        </button>
      )}
    </div>
  )
})
