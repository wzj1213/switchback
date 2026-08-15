import type { Command, Item, Thread, Turn } from "@omni/protocol"
import { ItemView } from "./ItemView.js"
import { ToolRun } from "./ToolRun.js"
import { TurnStatus } from "./TurnStatus.js"
import { Copyable } from "./Copyable.js"
import { groupRows } from "../group.js"
import { useStickToBottom } from "../useStickToBottom.js"

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
  const scroller = useStickToBottom<HTMLDivElement>(items.length + (turn === undefined ? 0 : 1))
  return (
    <div className="transcript" ref={scroller}>
      <div className="transcript__inner">
        {groupRows(items).map((row) =>
          row.kind === "run" ? (
            <ToolRun key={row.items[0]?.id} items={row.items} />
          ) : (
            <Copyable key={row.item.id} item={row.item} onCopy={onCopy}>
              <ItemView
                item={row.item}
                onResolve={(itemId, allow, remember) => {
                  send({ type: "approval.resolve", itemId, allow, remember })
                }}
              />
            </Copyable>
          ),
        )}
        <TurnStatus
          thread={thread}
          turn={turn}
          items={items}
          onInterrupt={() => {
            send({ type: "thread.interrupt", threadId: thread.id })
          }}
        />
      </div>
    </div>
  )
}
