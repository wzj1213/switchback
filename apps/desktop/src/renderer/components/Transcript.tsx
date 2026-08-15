import type { Command, Item, Thread, Turn } from "@omni/protocol"
import { useCallback } from "react"
import { ItemView } from "./ItemView.js"
import type { ResolveApproval } from "./Approval.js"
import { ToolRun } from "./ToolRun.js"
import { Copyable } from "./Copyable.js"
import { groupRows, type Row } from "../group.js"
import { spent } from "../status.js"
import { useStickToBottom } from "../useStickToBottom.js"
import { TurnStatus } from "./TurnStatus.js"
import { ArrowDownIcon } from "./icons.js"

/**
 * 一个字都还没说的会话。
 *
 * 空白的正文区技术上没错，但它什么都没告诉人：**这是新会话、还是在加载、
 * 还是坏了？** 一句话就能把三者区分开，顺带说清「你现在在哪个目录里干活」——
 * 那是每一句提问的隐含上下文，而它平时只在顶栏的标题里出现一次。
 */
function Blank({ thread }: { thread: Thread }): React.JSX.Element {
  return (
    <div className="blank">
      <div className="blank__glyph" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 4.5 6 8l-2.5 3.5M8 11.5h4.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="blank__title">
        在 <strong>{thread.title}</strong> 里做点什么？
      </p>
      <p className="blank__path">{thread.cwd}</p>
    </div>
  )
}

/** 一行的 key。三种行各有各的身份来源，抽出来免得写在 JSX 里看不清。 */
function keyOf(row: Row): string {
  if (row.kind === "turn") return `mark-${row.turnId}`
  if (row.kind === "run") return row.items[0]?.id ?? "run"
  return row.item.id
}

/** 一行。三种形态在这里分派，`Transcript` 只管遍历。 */
function RowView({
  row,
  onCopy,
  onResolve,
}: {
  row: Row
  onCopy: (text: string) => void
  onResolve: ResolveApproval
}): React.JSX.Element {
  // 一轮的分界。codex 在提问和回答之间放一条「已处理 X」加一道细线——
  // 没有它的话，连着问三轮的 transcript 是一条看不出接缝的长流
  if (row.kind === "turn") {
    return (
      <div className="turnmark">
        <span>已处理 {spent(row.ms)}</span>
      </div>
    )
  }
  if (row.kind === "run") return <ToolRun items={row.items} />
  return (
    <Copyable item={row.item} onCopy={onCopy}>
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
export function Transcript({
  thread,
  items,
  turn,
  send,
  onCopy,
}: {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  send: (command: Command) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const { scroller, inner, atBottom, toBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()
  // **必须是 useCallback。** 写成行内箭头函数的话每次 render 换一个身份，
  // `ItemView` 的 memo 会全部落空——而且是静默落空：功能全对，只是每帧白干一遍
  const onResolve = useCallback<ResolveApproval>(
    (itemId, allow, remember) => {
      send({ type: "approval.resolve", itemId, allow, remember })
    },
    [send],
  )
  return (
    <div className="transcript" ref={scroller}>
      {items.length === 0 && turn === undefined ? <Blank thread={thread} /> : null}
      <div className="transcript__inner" ref={inner}>
        {groupRows(items, turn?.id).map((row) => (
          <RowView key={keyOf(row)} row={row} onCopy={onCopy} onResolve={onResolve} />
        ))}
        {/* **状态行是对话流的最后一个孩子**，跟着内容滚。它说的是「它在想什么」，
            那是内容，不是状态栏。逃生口（停止）在输入区里，本来就不会滚走 */}
        <TurnStatus thread={thread} turn={turn} items={items} />
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
}
