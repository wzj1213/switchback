import { useRef } from "react"
import type { EngineInfo, Thread } from "@switchback/protocol"
import { CaretIcon } from "./icons.js"
import { RailToggle } from "./rail-toggle.js"
import { EnvCard } from "./EnvCard.js"
import { TimelineCard } from "./TimelineCard.js"
import { labelOf } from "./Composer.js"
import { nextEngine } from "../engines.js"
import type { LimitNotice } from "../limits.js"
import { TopBarActions } from "./TopBarActions.js"
import { useMessages } from "../i18n.js"
import { TOP_BAR } from "./TopBar.messages.js"

/**
 * 顶栏。
 *
 * ## 只放「说明状态」的东西，不放「能改状态」的东西
 *
 * 上一版这里摆着引擎和信任档两枚胶囊，而输入区里也有同样两枚——
 * 一样的文字出现在两个地方，**其中一个还点不动**。用户会去点那个点不动的，
 * 然后以为界面坏了。能改的那份留在输入区（手就在那儿），
 * 顶栏只留三类：会话身份、用量、以及**这个会话独有**的动作（分叉、对比）。
 *
 * 动作用图标按钮而不是文字胶囊：和旁边那些纯展示的胶囊长得一样的话，
 * 「可点」这件事就没有任何视觉线索了。
 */
/**
 * 挂在标题上的两张卡片：环境信息、引擎时间线。
 *
 * 合成一个组件是行数闸门逼的，但也顺：两张都锚在同一个按钮上、
 * 都默认不显示、都是「回看用」的东西。**同时只开一张**——
 * 两张浮层叠在一起时，后面那张既读不了也关不掉。
 */
function Cards({
  thread,
  engines,
  anchor,
  env,
  timeline,
  onCopy,
  onReveal,
  onClose,
}: {
  thread: Thread
  engines: readonly EngineInfo[]
  anchor: HTMLElement | null
  env: boolean
  timeline: boolean
  onCopy: (text: string) => void
  onReveal: (path: string) => void
  onClose: () => void
}): React.JSX.Element | null {
  if (timeline) {
    return (
      <TimelineCard thread={thread} engines={engines} anchor={anchor} onCopy={onCopy} onReveal={onReveal} onClose={onClose} />
    )
  }
  if (env) {
    return (
      <EnvCard
        thread={thread}
        engines={engines}
        anchor={anchor}
        onReveal={onReveal}
        onCopy={onCopy}
        onClose={onClose}
      />
    )
  }
  return null
}

export function TopBar({
  thread,
  engines,
  peer,
  onFork,
  onCompare,
  onReveal,
  onCopy,
  env,
  timeline,
  setTimeline,
  setEnv,
  limits,
  panelVisible,
  onPanel,
  railOpen,
  onRail,
}: {
  thread: Thread
  engines: readonly EngineInfo[]
  /** 有血缘的另一个会话。有才显示「对比」。 */
  peer: Thread | undefined
  onFork: (to: string) => void
  onCompare: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  /** 环境卡片开着没有。**状态在 `Workspace` 那层**——`/env` 命令也要能开它。 */
  env: boolean
  /** 引擎时间线开着没有。同理，`/timeline` 也要能开它。 */
  timeline: boolean
  setTimeline: (open: boolean) => void
  setEnv: (open: boolean) => void
  /** 账号额度提示。平时是 undefined（用得不多就不出声）。 */
  limits: LimitNotice | undefined
  panelVisible: boolean
  onPanel: () => void
  /** 左侧导航展开着没有 + 怎么切。⌘\ 与「显示」菜单走同一条路。 */
  railOpen: boolean
  onRail: () => void
}): React.JSX.Element {
  const m = useMessages(TOP_BAR)
  const next = nextEngine(engines, thread.engine)
  const handedOff = thread.engineHistory.length > 1
  const envAnchor = useRef<HTMLButtonElement>(null)
  return (
    <header className="topbar">
      {/* 侧栏开着时开关在侧栏顶带里；收起后才落到这里、紧挨交通灯（见 `rail-toggle.tsx`） */}
      {railOpen ? null : <RailToggle open={false} onToggle={onRail} />}
      {/* 标题点开是环境信息。**把它挂在标题上**而不是另放一颗按钮：
          「我在哪个会话里」和「这个会话跑在什么环境里」是同一个问题的两半 */}
      <button
        ref={envAnchor}
        type="button"
        className="topbar__title"
        title={m.env}
        aria-expanded={env}
        onClick={() => {
          setEnv(!env)
        }}
      >
        {/* 包一层：截断只能写在**子元素**上——flex 项默认 `min-width: auto` 不肯缩，
            标题会被齐着字形硬切，连后面那个箭头一起裁掉 */}
        <span className="topbar__title-text">{thread.title}</span>
        <CaretIcon size={13} />
      </button>
      <Cards
        thread={thread}
        engines={engines}
        anchor={envAnchor.current}
        env={env}
        timeline={timeline}
        onCopy={onCopy}
        onReveal={onReveal}
        onClose={() => {
          setEnv(false)
          setTimeline(false)
        }}
      />
      {/* **说明状态的话退成一行淡字，不再是胶囊**（UI 重构 P1）。灰底灰字的胶囊
          看起来像按钮又不太像——而这两样恰恰点不动。字面与悬停说明不变 */}
      {thread.detached === true ? (
        <span className="topbar__meta" title={m.detachedTip}>{m.detached}</span>
      ) : null}
      {handedOff ? (
        <span className="topbar__meta" title={thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")}>
          {m.relay(thread.engineHistory.length)}
        </span>
      ) : null}
      <span className="topbar__spacer" />
      <LimitPill limits={limits} />
      <TopBarActions
        panelVisible={panelVisible}
        peer={peer}
        next={next}
        thread={thread}
        onPanel={onPanel}
        onCompare={onCompare}
        onFork={onFork}
      />
    </header>
  )
}

/**
 * 账号额度那枚 pill。**只在快用完时出现**——见 `limits.ts` 里为什么不常驻。
 *
 * 满了和没满说的是两件事：没满时你想知道的是「哪个窗口」（本周还是 5 小时内），
 * 满了时你想知道的是**「什么时候恢复」**——那是唯一能照着行动的信息。
 */
function LimitPill({ limits }: { limits: LimitNotice | undefined }): React.JSX.Element | null {
  const m = useMessages(TOP_BAR)
  if (limits === undefined) return null
  const tail = limits.blocked
    ? limits.resetsAt === undefined
      ? ""
      : m.resets(limits.resetsAt)
    : limits.window === undefined
      ? ""
      : ` · ${limits.window}`
  return (
    <span className={`limit${limits.blocked ? " limit--blocked" : ""}`} title={m.quotaTip}>
      {limits.blocked ? m.exhausted : m.quota(limits.percent)}
      {tail}
    </span>
  )
}
