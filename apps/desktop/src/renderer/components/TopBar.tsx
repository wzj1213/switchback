import { useRef } from "react"
import type { EngineInfo, Thread } from "@switchback/protocol"
import { CaretIcon } from "./icons.js"
import { RailIcon } from "./icons-panel.js"
import { EnvCard } from "./EnvCard.js"
import { TimelineCard } from "./TimelineCard.js"
import { labelOf } from "./Composer.js"
import { nextEngine } from "../engines.js"
import type { LimitNotice } from "../limits.js"
import { TopBarActions } from "./TopBarActions.js"

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

/**
 * 侧栏开关。**摆在最左，在标题之前**——它管的是标题左边那一列，
 * 而 claude、codex、VS Code 三家的这颗都在同一个位置。
 * 导航收起时交通灯会挪到顶栏里，这颗就紧挨着它们（见 `.shell--norail`）。
 */
function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`iconbtn${open ? "" : " iconbtn--on"}`}
      data-tip={open ? "收起侧栏（⌘\\）" : "展开侧栏（⌘\\）"}
      aria-label={open ? "收起侧栏" : "展开侧栏"}
      aria-pressed={!open}
      onClick={onToggle}
    >
      <RailIcon size={14} className={`rail-icon${open ? "" : " rail-icon--closed"}`} />
    </button>
  )
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
  const next = nextEngine(engines, thread.engine)
  const handedOff = thread.engineHistory.length > 1
  const envAnchor = useRef<HTMLButtonElement>(null)
  return (
    <header className="topbar">
      <RailToggle open={railOpen} onToggle={onRail} />
      {/* 标题点开是环境信息。**把它挂在标题上**而不是另放一颗按钮：
          「我在哪个会话里」和「这个会话跑在什么环境里」是同一个问题的两半 */}
      <button
        ref={envAnchor}
        type="button"
        className="topbar__title"
        title="环境信息"
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
      {thread.detached === true ? <span className="badge badge--muted">历史记录</span> : null}
      {handedOff ? (
        <span className="badge" title={thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")}>
          接力 {thread.engineHistory.length} 手
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
  if (limits === undefined) return null
  const tail = limits.blocked
    ? limits.resetsAt === undefined
      ? ""
      : ` · ${limits.resetsAt} 恢复`
    : limits.window === undefined
      ? ""
      : ` · ${limits.window}`
  return (
    <span className={`limit${limits.blocked ? " limit--blocked" : ""}`} title="账号额度，不是这个会话的用量">
      {limits.blocked ? "额度已用尽" : `额度 ${String(limits.percent)}%`}
      {tail}
    </span>
  )
}
