import type { Command, Item, Thread, Turn } from "@omni/protocol"
import { useCallback } from "react"
import { ItemView } from "./ItemView.js"
import type { ResolveApproval } from "./Approval.js"
import { ToolRun } from "./ToolRun.js"
import { Copyable } from "./Copyable.js"
import { groupRows } from "../group.js"
import { useStickToBottom } from "../useStickToBottom.js"

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
  const { scroller, inner } = useStickToBottom<HTMLDivElement, HTMLDivElement>()
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
        {groupRows(items).map((row) =>
          row.kind === "run" ? (
            <ToolRun key={row.items[0]?.id} items={row.items} />
          ) : (
            <Copyable key={row.item.id} item={row.item} onCopy={onCopy}>
              <ItemView item={row.item} onResolve={onResolve} />
            </Copyable>
          ),
        )}
      </div>
    </div>
  )
}
