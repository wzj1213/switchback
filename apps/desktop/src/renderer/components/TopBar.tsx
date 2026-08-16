import { useRef } from "react"
import type { EngineInfo, Thread, Usage } from "@omni/protocol"
import { CaretIcon, CompareIcon, ForkIcon } from "./icons.js"
import { ContextMeter } from "./ContextMeter.js"
import { EnvCard } from "./EnvCard.js"
import { labelOf } from "./Composer.js"
import { nextEngine } from "../engines.js"
import type { LimitNotice } from "../limits.js"

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
export function TopBar({
  thread,
  usage,
  engines,
  peer,
  onFork,
  onCompare,
  onReveal,
  onCopy,
  env,
  setEnv,
  limits,
}: {
  thread: Thread
  usage: Usage | undefined
  engines: readonly EngineInfo[]
  /** 有血缘的另一个会话。有才显示「对比」。 */
  peer: Thread | undefined
  onFork: (to: string) => void
  onCompare: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  /** 环境卡片开着没有。**状态在 `Workspace` 那层**——`/env` 命令也要能开它。 */
  env: boolean
  setEnv: (open: boolean) => void
  /** 账号额度提示。平时是 undefined（用得不多就不出声）。 */
  limits: LimitNotice | undefined
}): React.JSX.Element {
  const next = nextEngine(engines, thread.engine)
  const handedOff = thread.engineHistory.length > 1
  const envAnchor = useRef<HTMLButtonElement>(null)
  return (
    <header className="topbar">
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
        {thread.title}
        <CaretIcon size={11} />
      </button>
      {env ? (
        <EnvCard
          thread={thread}
          engines={engines}
          anchor={envAnchor.current}
          onReveal={onReveal}
          onCopy={onCopy}
          onClose={() => {
            setEnv(false)
          }}
        />
      ) : null}
      {thread.detached === true ? <span className="badge badge--muted">历史记录</span> : null}
      {handedOff ? (
        <span className="badge" title={thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")}>
          接力 {thread.engineHistory.length} 手
        </span>
      ) : null}
      <span className="topbar__spacer" />
      <ContextMeter usage={usage} />
      {/* 额度只在快用完时出现。放在用量旁边——那儿本来就是「花了多少」的地盘 */}
      {limits === undefined ? null : (
        <span className={`limit${limits.blocked ? " limit--blocked" : ""}`} title="账号额度，不是这个会话的用量">
          {limits.blocked ? "额度已用尽" : `额度 ${String(limits.percent)}%`}
          {limits.window === undefined ? "" : ` · ${limits.window}`}
        </span>
      )}
      {peer === undefined ? null : (
        <button
          className="iconbtn"
          type="button"
          title={`和「${peer.title}」并排比一比（⇧⌘D）`}
          aria-label="对比分叉"
          onClick={onCompare}
        >
          <CompareIcon size={14} />
        </button>
      )}
      {next === undefined ? null : (
        <button
          className="iconbtn"
          type="button"
          title={`用 ${next.label} 另起一个会话跑同一件事（原会话保留）`}
          aria-label={`分叉到 ${next.label}`}
          onClick={() => {
            onFork(next.id)
          }}
        >
          <ForkIcon size={14} />
        </button>
      )}
    </header>
  )
}
