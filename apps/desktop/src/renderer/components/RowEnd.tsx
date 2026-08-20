import type { Thread, ThreadStatus } from "@omni/protocol"
import { SpinnerIcon } from "./icons.js"
import { sinceOf } from "../status.js"
import { useMinute } from "../useMinute.js"

/*
 * 侧栏会话行的状态点和右边那一列。从 `SidebarRows.tsx` 拆出来是行数闸门逼的，
 * 但边界也顺：那边管「一行怎么摆、怎么拖、怎么改名」，这边只管「这一行现在怎么样」。
 */

export const DOT_CLASS: Record<ThreadStatus, string> = {
  // 起引擎那几百毫秒：和「跑着」用同一个呼吸动画，因为**对用户来说就是同一件事**
  //（有东西在动、还不能输入），没必要为它发明第三种视觉语言
  starting: " row__dot--running",
  idle: "",
  running: " row__dot--running",
  waiting_approval: " row__dot--waiting",
  failed: " row__dot--failed",
}

/** 光靠颜色说不清「要你去做什么」，这几档补一句字。 */
const NOTE: Partial<Record<ThreadStatus, string>> = {
  waiting_approval: "待批",
  starting: "启动中",
  failed: "失败",
}

/**
 * 行右边那一列。**一条规矩管一列：默认答「多久以前」，有更要紧的事就顶掉它。**
 *
 * 那一格以前是空的（只有置顶段拿去写项目名）。而会话标题彼此都长得差不多
 *（「omni」「接着上面…」「修一下那个 bug」），一列排下来唯一能把它们区分开的
 * 就是新旧——`Thread.updatedAt` 一直有，只是从来没显示过。
 *
 * 顶掉它的有四种，按要紧程度排：正在跑（那颗转圈）、待批、失败、启动中。
 * 置顶段的项目名也归这一列，所以它在的时候时间也让位。
 */
export function RowEnd({ thread, aside }: { thread: Thread; aside?: string }): React.JSX.Element {
  const note = NOTE[thread.status]
  const running = thread.status === "running"
  return (
    <>
      {aside === undefined ? null : <span className="row__aside">{aside}</span>}
      {aside === undefined && !running && note === undefined ? (
        <Since at={thread.updatedAt} />
      ) : null}
      {/* 跑着的时候右侧转一个圈。**这是唯一能在不切会话的情况下看出「那边还在忙」
          的地方**——状态点太小、又和「有未读」这类含义抢同一个位置 */}
      {running ? (
        <span className="row__spin" aria-label="正在运行">
          <SpinnerIcon />
        </span>
      ) : null}
      {note === undefined ? null : (
        <span className={`row__note${thread.status === "failed" ? " row__note--fail" : ""}`}>
          {note}
        </span>
      )}
    </>
  )
}

/**
 * 「多久以前」。**单独一个组件**：它每分钟要醒一次，而醒的只该是这一小段字，
 * 不该是整行——那一行还挂着拖放、改名、删除确认一堆状态。
 */
function Since({ at }: { at: number }): React.JSX.Element {
  return <span className="row__time">{sinceOf(at, useMinute())}</span>
}
