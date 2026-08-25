import type { Command, Item, Thread } from "@omni/protocol"
import { PlanPanel } from "./PlanPanel.js"
import { QuestionStack } from "./QuestionCard.js"
import { Queued } from "./Queued.js"
import { GoalBar } from "./GoalBar.js"

interface Props {
  thread: Thread
  items: readonly Item[]
  send: (command: Command) => void
}

/** 转录区与输入框之间：当前计划 → 尚未发出的排队文字。 */
export function Between(props: Props): React.JSX.Element {
  const waiting = props.thread.queued ?? []
  const active = props.thread.status === "running" || props.thread.status === "waiting_approval"
  return (
    <>
      <GoalBar goal={props.thread.goal} />
      <PlanPanel key={props.thread.id} items={props.items} running={props.thread.status === "running"} />
      <Queued
        texts={waiting}
        attachments={props.thread.queuedAttachments ?? []}
        active={active}
        {...(active && props.thread.capabilities?.steer === true
          ? {
              onInsert: () => {
                props.send({ type: "thread.steerQueued", threadId: props.thread.id })
              },
            }
          : {})}
        onDrop={(index?: number) => {
          // 下标缺席＝整队一起取回。**两种粒度都留着**：改主意时想拿回的常常
          // 只是最后那句，而「算了都不发了」也是个真实的动作
          props.send({
            type: "thread.unqueue",
            threadId: props.thread.id,
            ...(index === undefined ? {} : { index }),
          })
        }}
      />
      <QuestionStack
        threadId={props.thread.id}
        groups={props.thread.pendingQuestions ?? []}
        send={props.send}
      />
    </>
  )
}
