import type { EngineInfo, Thread, ThreadStatus } from "@switchback/protocol"
import { SpinnerIcon } from "./icons.js"
import { sinceOf } from "../status.js"
import { useMinute } from "../useMinute.js"
import { engineTint } from "../engine-mark.js"
import { labelOf } from "./Composer.js"
import { displayStatus } from "@switchback/store"

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
 * 换过引擎的会话，在这一行上留一颗引擎色的点。
 *
 * **只有换过的才有。** 一家跑到底时这颗点在整列上是同一个颜色，
 * 说了等于没说；而换过之后，「这条现在归谁」正是你在侧栏扫一眼时想知道的事
 *——尤其是上一家出了问题、你为此才换的那几条。
 *
 * 颜色和转录区那条分界、左缘导航是同一套（`engineTint`）：三处对得上，
 * 这颗点才不用配一行字也能读懂。名字在悬停卡和 `title` 里，一个字都没少。
 */
function EngineDot({
  thread,
  engines,
}: {
  thread: Thread
  engines: readonly EngineInfo[]
}): React.JSX.Element | null {
  if (thread.engineHistory.length < 2) return null
  const name = labelOf(engines, thread.engine)
  const note = `现在归 ${name} 跑 · 接力 ${String(thread.engineHistory.length)} 手`
  return (
    <span
      className="row__engine"
      style={{ background: engineTint(thread.engine) }}
      role="img"
      aria-label={note}
      title={note}
    />
  )
}

/**
 * 行右边那一列。**一条规矩管一列：默认答「多久以前」，有更要紧的事就顶掉它。**
 *
 * 那一格以前是空的（只有置顶段拿去写项目名）。而会话标题彼此都长得差不多
 *（「Switchback」「接着上面…」「修一下那个 bug」），一列排下来唯一能把它们区分开的
 * 就是新旧——`Thread.updatedAt` 一直有，只是从来没显示过。
 *
 * 顶掉它的有四种，按要紧程度排：正在跑（那颗转圈）、待批、失败、启动中。
 * 置顶段的项目名也归这一列，所以它在的时候时间也让位。
 */
export function RowEnd({
  thread,
  engines,
  aside,
  unread = false,
}: {
  thread: Thread
  /** 引擎清单：那颗引擎点的 `title` 要把 id 翻成人话。 */
  engines: readonly EngineInfo[]
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
  // 主轮之外还挂着权限请求的，照「待批」画（见 store 的 `displayStatus`）
  const status = displayStatus(thread)
  const note = NOTE[status]
  const running = status === "running"
  // 包一层 `.row__end`：悬停时整列让位给行内操作，操作按钮浮在这一列上（见 app-sidebar.css）
  return (
    <span className="row__end">
      <EngineDot thread={thread} engines={engines} />
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
        <span className={`row__note${status === "failed" ? " row__note--fail" : ""}`}>
          {note}
        </span>
      )}
    </span>
  )
}

/**
 * 「多久以前」。**单独一个组件**：它每分钟要醒一次，而醒的只该是这一小段字，
 * 不该是整行——那一行还挂着拖放、改名、删除确认一堆状态。
 */
function Since({ at, bright = false }: { at: number; bright?: boolean }): React.JSX.Element {
  return <span className={`row__time${bright ? " row__time--bright" : ""}`}>{sinceOf(at, useMinute())}</span>
}

/**
 * 项目行的行尾那一列：待批、在跑、未读，最后是会话条数。
 * 和会话行的 `RowEnd` 同一个壳（`.row__end`）：悬停时整列让位给行内操作。
 */
export function GroupEnd({ collapsed, waiting, running, unread, count }: {
  collapsed: boolean
  waiting: number
  running: number
  unread: number
  count: number
}): React.JSX.Element {
  const unreadLabel = `${String(unread)} 条跑完了还没看`
  return (
    <span className="row__end">
      {/* 折起来的时候，「这个项目里有没有东西在跑」只剩这一个出口。
              展开时每行自己会转圈，这里就不重复了 */}
      {collapsed && waiting > 0 ? (
        <span className="row__wait" aria-label={`${String(waiting)} 个等你批`}>
          待批
        </span>
      ) : null}
      {collapsed && running > 0 ? (
        <span className="row__spin" aria-label={`${String(running)} 个在跑`}>
          <SpinnerIcon />
        </span>
      ) : null}
      {/* 跑完了还没看的。**不摆数字**：右边已经有一个数（会话条数），
              两个数字挨着谁也说不清哪个是哪个——一颗点说「里面有新东西」就够 */}
      {collapsed && unread > 0 ? (
        <span
          className="row__dot row__dot--unread"
          role="img"
          aria-label={unreadLabel}
          title={unreadLabel}
        />
      ) : null}
      <span className="row__count">{count}</span>
    </span>
  )
}
