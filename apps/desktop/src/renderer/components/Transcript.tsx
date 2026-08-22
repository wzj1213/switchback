import type { Command, Item, TaskRun, Thread, Turn } from "@omni/protocol"
import { memo, useCallback, useMemo, useState } from "react"
import { ItemView } from "./ItemView.js"
import type { ResolveApproval } from "./Approval.js"
import { ToolRun } from "./ToolRun.js"
import { Copyable } from "./Copyable.js"
import { foldTurns, groupRows, type Row } from "../group.js"
import { spent } from "../status.js"
import { useStickToBottom } from "../useStickToBottom.js"
import { TurnStatus } from "./TurnStatus.js"
import { ArrowDownIcon, ChevronIcon } from "./icons.js"
import { PencilIcon, ResetIcon } from "./icons-activity.js"
import { Changed } from "./Changed.js"
import { TranscriptBlank } from "./transcript-blank.js"

/** 一行的 key。三种行各有各的身份来源，抽出来免得写在 JSX 里看不清。 */
function keyOf(row: Row): string {
  if (row.kind === "turn") return `mark-${row.turnId}`
  if (row.kind === "run") return row.items[0]?.id ?? "run"
  return row.item.id
}

/** 一行。三种形态在这里分派，`Transcript` 只管遍历。 */
function RowView({
  row,
  cwd,
  onRewind,
  onReuse,
  folded,
  onFold,
  onCopy,
  onResolve,
}: {
  row: Row
  /** 工作区路径。工具行据此把绝对路径写成相对的。 */
  cwd: string
  /** 从某一轮之前重来。 */
  onRewind: (turnId: string) => void
  /** 把某条自己发过的话填回输入框，改完再发。**对比视图里没有输入框，所以可以缺席。** */
  onReuse?: (text: string) => void
  folded: boolean
  onFold: (turnId: string) => void
  onCopy: (text: string) => void
  onResolve: ResolveApproval
}): React.JSX.Element {
  // 一轮的分界。codex 在提问和回答之间放一条「已处理 X」加一道细线——
  // 没有它的话，连着问三轮的 transcript 是一条看不出接缝的长流
  if (row.kind === "turn") {
    // **整条线可点**：它本来就是这一轮回答的表头，折起来天经地义。
    // 只把小箭头做成热区的话，那是个 12px 的目标，得瞄准才点得中
    return (
      <div className="turnmark__row">
        <button
          type="button"
          className="turnmark"
          data-folded={folded}
          aria-expanded={!folded}
          onClick={() => {
            onFold(row.turnId)
          }}
        >
          <span>已处理 {spent(row.ms)}</span>
          <ChevronIcon open={!folded} size={11} />
        </button>
        {/* **回到还没发生这一轮的时候。** 走错方向时唯一的出路，
          否则只能把整个会话丢掉重开——而那会连前面对的部分一起丢 */}
        <button
          type="button"
          className="act turnmark__act"
          title="新开一个会话，只带这一轮之前的内容（原会话保留）"
          onClick={() => {
            onRewind(row.turnId)
          }}
        >
          <ResetIcon size={11} />
          从这里重来
        </button>
      </div>
    )
  }
  if (row.kind === "run") return <ToolRun items={row.items} cwd={cwd} />
  /* **只有自己发过的话能改。** agent 说的话改了再发没有意义——
     那不是你的话，改完发出去等于替它编一句 */
  const mine =
    onReuse !== undefined && row.item.kind === "user_message" && row.item.origin === undefined
  return (
    <Copyable
      item={row.item}
      onCopy={onCopy}
      {...(mine
        ? {
            extra: (
              <button
                type="button"
                className="act"
                onClick={() => {
                  onReuse(row.item.kind === "user_message" ? row.item.text : "")
                }}
              >
                <PencilIcon size={11} />
                改一改再发
              </button>
            ),
          }
        : {})}
    >
      <ItemView item={row.item} onResolve={onResolve} />
    </Copyable>
  )
}

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
  send,
  onCopy,
  onReuse,
  stamp,
  onReveal,
  onReview,
}: {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  /** 此刻在跑的子 agent。**引擎报了才有**，一个都没有时是空数组。 */
  tasks: readonly TaskRun[]
  send: (command: Command) => void
  onCopy: (text: string) => void
  /** 把一句话填回输入框。对比视图不给（那边没有输入框）。 */
  onReuse?: (text: string) => void
  /** 工作区变更卡只在正常工作区显示；对比视图不传这三项。 */
  stamp?: string
  onReveal?: (path: string) => void
  onReview?: () => void
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
    () => foldTurns(groupRows(items, turn?.id), folded),
    [items, turn?.id, folded],
  )
  // **必须是 useCallback。** 写成行内箭头函数的话每次 render 换一个身份，
  // `ItemView` 的 memo 会全部落空——而且是静默落空：功能全对，只是每帧白干一遍
  const onResolve = useCallback<ResolveApproval>(
    (itemId, allow, remember, passTurn) => {
      send({
        type: "approval.resolve",
        itemId,
        allow,
        remember,
        ...(passTurn === true ? { passTurn } : {}),
      })
    },
    [send],
  )
  return (
    <div className="transcript" ref={scroller}>
      {items.length === 0 && turn === undefined ? <TranscriptBlank thread={thread} /> : null}
      <div className="transcript__inner" ref={inner}>
        {rows.map((row) => (
          <RowView
            key={keyOf(row)}
            row={row}
            cwd={thread.cwd}
            onRewind={(turnId) => {
              send({ type: "thread.rewind", threadId: thread.id, turnId })
            }}
            onReuse={onReuse}
            folded={row.kind === "turn" && folded.has(row.turnId)}
            onFold={onFold}
            onCopy={onCopy}
            onResolve={onResolve}
          />
        ))}
        {/* **状态行是对话流的最后一个孩子**，跟着内容滚。它说的是「它在想什么」，
            那是内容，不是状态栏。逃生口（停止）在输入区里，本来就不会滚走 */}
        <TurnStatus thread={thread} turn={turn} items={items} tasks={tasks} />
        {stamp === undefined || onReveal === undefined || onReview === undefined ? null : (
          <Changed
            items={items}
            cwd={thread.cwd}
            stamp={stamp}
            hidden={turn !== undefined || thread.status === "starting"}
            onReveal={onReveal}
            onCopy={onCopy}
            onReview={onReview}
          />
        )}
      </div>
      {/* 往回翻的时候给一条回去的路。**这才是「逃生口不该滚走」的正确解法**——
          不是把状态行钉住，而是给一个「回到底部」 */}
      {atBottom ? null : (
        <button type="button" className="tobottom" aria-label="回到底部" onClick={toBottom}>
          <ArrowDownIcon />
        </button>
      )}
    </div>
  )
})
