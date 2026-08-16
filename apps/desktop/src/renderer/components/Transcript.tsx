import type { Command, Item, Thread, Turn } from "@omni/protocol"
import { useCallback, useMemo, useState } from "react"
import { ItemView } from "./ItemView.js"
import type { ResolveApproval } from "./Approval.js"
import { ToolRun } from "./ToolRun.js"
import { Copyable } from "./Copyable.js"
import { foldTurns, groupRows, type Row } from "../group.js"
import { spent } from "../status.js"
import { useStickToBottom } from "../useStickToBottom.js"
import { TurnStatus } from "./TurnStatus.js"
import { ArrowDownIcon, ChevronIcon } from "./icons.js"

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
        {thread.adopted === true ? "接着聊就行" : <>在 <strong>{thread.title}</strong> 里做点什么？</>}
      </p>
      <p className="blank__path">{thread.cwd}</p>
      {/* **这条必须说清楚。** 接过来的会话在 omni 这边是空的，而引擎那边
          什么都记得（codex 的 `thread/items/list` 目前回 not supported yet，
          历史内容取不回来）。不说的话，人打开看到一片空白会以为上下文丢了，
          于是把已经说过的话再说一遍——「看起来丢了但其实没丢」比真丢了更难受 */}
      {thread.adopted === true ? (
        <p className="blank__note">
          这条是从引擎那边接过来的。<strong>前面聊过什么它都记得</strong>，
          只是那些内容存在引擎那边、omni 这里搬不过来，所以上面是空的。
          （Claude 的历史能搬，codex 目前不行——它还没开放读取历史内容的接口。）
        </p>
      ) : null}
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
        className="turnmark__act"
        title="新开一个会话，只带这一轮之前的内容（原会话保留）"
        onClick={() => {
          onRewind(row.turnId)
        }}
      >
        从这里重来
      </button>
      </div>
    )
  }
  if (row.kind === "run") return <ToolRun items={row.items} cwd={cwd} />
  return (
    <Copyable item={row.item} onCopy={onCopy}>
      <ItemView item={row.item} onResolve={onResolve} />
      {/* **只有自己发过的话能「改一改再发」。** agent 说的话改了再发没有意义——
          那不是你的话，改完发出去等于替它编一句 */}
      {onReuse !== undefined && row.item.kind === "user_message" && row.item.origin === undefined ? (
        <button
          type="button"
          className="msg__reuse"
          onClick={() => {
            onReuse(row.item.kind === "user_message" ? row.item.text : "")
          }}
        >
          改一改再发
        </button>
      ) : null}
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
  onReuse,
}: {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  send: (command: Command) => void
  onCopy: (text: string) => void
  /** 把一句话填回输入框。对比视图不给（那边没有输入框）。 */
  onReuse?: (text: string) => void
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
  const rows = useMemo(() => foldTurns(groupRows(items, turn?.id), folded), [items, turn?.id, folded])
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
