import type { Command, Item, Lane, Thread } from "@omni/protocol"
import { PlanPanel } from "./PlanPanel.js"
import { QuestionStack } from "./QuestionCard.js"
import { Changed } from "./Changed.js"
import { Queued } from "./Queued.js"
import { GoalBar } from "./GoalBar.js"
import { ActivityDock } from "./ActivityDock.js"

interface Props {
  thread: Thread
  items: readonly Item[]
  send: (command: Command) => void
  /** 「工作区可能变了」的节拍。见 `stamp.ts`。 */
  stamp: string | undefined
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
  lanes: readonly Lane[]
  onOpenLane: (laneId: string) => void
}

/**
 * 转录区与输入框之间那一块：**计划与变更并排一行**，底下是还没发出去的话。
 *
 * ## 为什么它们要挤在一行
 *
 * 上一版是三条各自独立的带子：变更卡（在转录区底部，跟着正文滚）、计划条、排队条。
 * 三个盒子、三条通栏线、三种对齐方式压在输入框上面——而它们回答的是同一个问题：
 * **你按下回车之前该知道的东西。**
 *
 * 原型（`docs/界面细节打磨-v4.html`「计划并进那一排」）把这件事定死了，
 * 连验收数都写了：「输入框上方最多几行：1（现在 3）」。这一版把前两条并了。
 *
 * ## 变更卡为什么从转录区搬出来
 *
 * 它原来是转录区的最后一个孩子，**跟着内容滚**——理由是「它是对话结果的一部分」。
 * 但那条理由和「你按回车之前该知道什么」是冲突的：往回翻一屏，它就滚没了，
 * 而那时你恰恰更想知道这一轮到底动了哪些文件。并进这一行之后它不再滚走。
 */
export function Between(props: Props): React.JSX.Element {
  const waiting = props.thread.queued ?? []
  const active = props.thread.status === "running" || props.thread.status === "waiting_approval"
  return (
    <>
      <GoalBar goal={props.thread.goal} />
      <div className="brief">
        <ActivityDock lanes={props.lanes} onOpen={props.onOpenLane} />
        <PlanPanel key={props.thread.id} items={props.items} running={props.thread.status === "running"} />
        {props.stamp === undefined ? null : (
          <Changed
            items={props.items}
            threadId={props.thread.id}
            cwd={props.thread.cwd}
            stamp={props.stamp}
            onReveal={props.onReveal}
            onCopy={props.onCopy}
            onReview={props.onReview}
          />
        )}
      </div>
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
