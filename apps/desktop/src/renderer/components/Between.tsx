import type { Command, Item, Thread } from "@switchback/protocol"
import { QuestionStack } from "./QuestionCard.js"
import { OutsideApprovals } from "./OutsideApprovals.js"
import { Queued } from "./Queued.js"
import { GoalBar } from "./GoalBar.js"

interface Props {
  thread: Thread
  items: readonly Item[]
  send: (command: Command) => void
  /** 「工作区可能变了」的节拍。见 `stamp.ts`。 */
  stamp: string | undefined
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
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
 * ## 变更卡为什么又回到了转录区，而且一轮一张
 *
 * 它一度是转录区最后一个孩子（整条会话一张，跟着内容滚），后来搬进这一行钉住。
 * 两版都错在同一个地方：**一张卡说的是整条会话的总账**，而人要问的是
 * 「刚才那一轮动了什么」。钉住之后更别扭——你正读第三轮，它写的是十轮的累计。
 *
 * 现在一轮一张，跟在那一轮末尾（`components/TurnEdits.tsx`）。这一行于是只剩
 * 计划与旁路，「输入框上方最多 1 行」那条验收数守得更稳。
 *
 * ## 计划与旁路后来搬进了输入卡
 *
 * UI 重构 P2 把那一行做成输入卡顶上的托盘（`composer-tray.tsx`）：它说的就是
 * 「按下回车之前该知道的」，长在输入卡上比漂在桌宠头顶更对得齐。这里只剩目标、
 * 待发送与等人回答的那几张。
 */
export function Between(props: Props): React.JSX.Element {
  const waiting = props.thread.queued ?? []
  const active = props.thread.status === "running" || props.thread.status === "waiting_approval"
  return (
    <>
      <GoalBar goal={props.thread.goal} />
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
      <OutsideApprovals approvals={props.thread.pendingApprovals ?? []} send={props.send} now={Date.now()} />
      <QuestionStack
        threadId={props.thread.id}
        groups={props.thread.pendingQuestions ?? []}
        send={props.send}
      />
    </>
  )
}
