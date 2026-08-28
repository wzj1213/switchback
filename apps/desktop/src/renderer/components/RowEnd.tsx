import type { Thread, ThreadStatus } from "@omni/protocol"
import { SpinnerIcon } from "./icons.js"
import { sinceOf } from "../status.js"
import { useMinute } from "../useMinute.js"

/*
 * 侧栏会话行的状态点和右边那一列。从 `SidebarRows.tsx` 拆出来是行数闸门逼的，
 * 但边界也顺：那边管「一行怎么摆、怎么拖、怎么改名」，这边只管「这一行现在怎么样」。
 */

const DOT_CLASS: Record<ThreadStatus, string> = {
  // 起引擎那几百毫秒：和「跑着」用同一个呼吸动画，因为**对用户来说就是同一件事**
  //（有东西在动、还不能输入），没必要为它发明第三种视觉语言
  starting: " row__dot--running",
  idle: "",
  running: " row__dot--running",
  waiting_approval: " row__dot--waiting",
  failed: " row__dot--failed",
}

/** 未读那颗点的说明。**颜色之外必须有一句话**：读屏用户没有颜色。 */
const UNREAD = "跑完了，还没打开过"

/**
 * 行首那颗状态点。
 *
 * **未读只在空闲那一档顶上去**——它说的是「跑完了你还没看」，
 * 而在跑、待批、失败各自都有更要紧的话要说，那几档本来就亮着，
 * 再改一次颜色只会把「现在到底怎么了」说糊。
 */
export function Dot({ status, unread }: { status: ThreadStatus; unread: boolean }): React.JSX.Element {
  if (!unread || status !== "idle") return <span className={`row__dot${DOT_CLASS[status]}`} />
  // `role="img"` 是必须的：光挂 `aria-label` 的裸 span，读屏不保证念得出来
  return <span className="row__dot row__dot--unread" role="img" aria-label={UNREAD} title={UNREAD} />
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
export function RowEnd({
  thread,
  aside,
  unread = false,
}: {
  thread: Thread
  aside?: string
  /**
   * 后台跑完了、还没打开过。
   *
   * **不顶掉时间**：这一列答的是「多久以前」，未读答的是「你看没看过」
   *（归行首那颗点，`Dot`），用一个新问题的答案换掉老问题的答案是亏的——
   * 尤其「一小时前跑完的」这句话本身就是未读那条最想知道的。
   * 所以未读在这里只把时间和整行提一档亮度（`.row--unread`）。
   */
  unread?: boolean
}): React.JSX.Element {
  const note = NOTE[thread.status]
  const running = thread.status === "running"
  return (
    <>
      {aside === undefined ? null : <span className="row__aside">{aside}</span>}
      {aside === undefined && !running && note === undefined ? (
        <Since at={thread.updatedAt} bright={unread} />
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
function Since({ at, bright = false }: { at: number; bright?: boolean }): React.JSX.Element {
  return <span className={`row__time${bright ? " row__time--bright" : ""}`}>{sinceOf(at, useMinute())}</span>
}
