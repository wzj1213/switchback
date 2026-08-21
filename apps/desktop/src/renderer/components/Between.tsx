import type { Command, Item, Thread } from "@omni/protocol"
import { PlanPanel } from "./PlanPanel.js"
import { Queued } from "./Queued.js"

interface Props {
  thread: Thread
  items: readonly Item[]
  send: (command: Command) => void
  onReuse: (text: string) => void
}

/** 转录区与输入框之间：当前计划 → 尚未发出的排队文字。 */
export function Between(props: Props): React.JSX.Element {
  const waiting = props.thread.queued ?? []
  return (
    <>
      <PlanPanel key={props.thread.id} items={props.items} />
      <Queued
        texts={waiting}
        {...(props.thread.capabilities?.steer === true
          ? {
              onInsert: () => {
                props.send({ type: "thread.steerQueued", threadId: props.thread.id })
              },
            }
          : {})}
        onDrop={() => {
          if (waiting.length > 0) props.onReuse(waiting.join("\n"))
          props.send({ type: "thread.unqueue", threadId: props.thread.id })
        }}
      />
    </>
  )
}
