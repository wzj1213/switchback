import type { Lane } from "@omni/protocol"
import type { AsideTabs } from "../aside-tabs.js"
import { LaneTree } from "./LaneTree.js"
import { PlanMark } from "./PlanMark.js"
import { compact } from "../usage.js"

/**
 * 第三栏：并排看旁路。
 *
 * ## 它买到的是内联卡片买不到的两件事
 *
 * **钉住**（主线滚动时树不动）与**并排**（主线跑着的时候读旁路）。其余八成内联就有，
 * 所以内联那一批先发、这一批后做——任何一批出问题，前一批都是可用的。
 *
 * ## 关掉一个标签 ≠ 结束那条 lane
 *
 * 那颗「×」是「不看了」，不是「杀掉子 agent」。关掉之后它照跑，从卡片能再点开，
 * 树接着往下长。整套状态在 `aside-tabs.ts`，那里一个函数都碰不到引擎。
 *
 * ## 全关完整列不渲染，不是宽度 0
 *
 * 宽度 0 的列里内容仍然挂着、仍然在流式输出时触发 memo 比较——那是一份看不见的
 * 性能账，而且是「只在长会话上表现为卡顿」的那种。所以 `active` 空着时 `App`
 * 整个不渲染这一列。
 */

const KIND: Readonly<Record<Lane["kind"], string>> = { activity: "只读", aside: "侧问" }

function Tab({
  lane,
  on,
  onPick,
  onClose,
}: {
  lane: Lane
  on: boolean
  onPick: (id: string) => void
  onClose: (id: string) => void
}): React.JSX.Element {
  return (
    <span className={`atab${on ? " atab--on" : ""}`}>
      <button type="button" className="atab__go" onClick={() => { onPick(lane.id) }} title={lane.title}>
        <PlanMark
          status={lane.status === "running" ? "in_progress" : lane.status === "failed" ? "failed" : "done"}
          spinning={lane.status === "running"}
        />
        {/* **标签一多就只剩图标**：六个标签在 400px 里挤成一排读不出的碎字，
            还不如让「有几条在开着」一眼数得出来。展开的永远只有当前这个 */}
        <span className="atab__name">{lane.title}</span>
      </button>
      <button
        type="button"
        className="atab__x"
        onClick={() => { onClose(lane.id) }}
        aria-label={`关掉「${lane.title}」这个标签（它还在跑，只是不看了）`}
      >
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  )
}

export function AsidePane({
  lanes,
  tabs,
  onPick,
  onClose,
}: {
  lanes: readonly Lane[]
  tabs: AsideTabs
  onPick: (id: string) => void
  onClose: (id: string) => void
}): React.JSX.Element | null {
  const open = tabs.open.map((id) => lanes.find((l) => l.id === id)).filter((l): l is Lane => l !== undefined)
  const active = lanes.find((l) => l.id === tabs.active)
  if (active === undefined) return null
  const nodes = active.progress?.nodes ?? []
  return (
    <aside className="aside" aria-label="旁路">
      <div className="aside__tabs" role="tablist">
        {open.map((lane) => (
          <Tab key={lane.id} lane={lane} on={lane.id === active.id} onPick={onPick} onClose={onClose} />
        ))}
      </div>
      <div className="aside__bar">
        <span className="aside__kind">{KIND[active.kind]}</span>
        {nodes.length === 0 ? null : <span className="aside__meta">{nodes.length} 个节点</span>}
        {active.progress?.budget === undefined ? null : (
          <span className="aside__meta">
            {/* **和卡片走同一个 `compact()`**：一处 `186k` 一处 `186000`，
                同一个数字两种写法，读的人会以为它们不是一回事 */}
            {compact(active.progress.budget.used)}
            {active.progress.budget.total === undefined ? "" : ` / ${compact(active.progress.budget.total)}`}
          </span>
        )}
      </div>
      <div className="aside__body">
        {/* **报不上来就说报不上来**，不画一棵空树也不画一条永远 0% 的进度条 */}
        {nodes.length === 0 ? (
          <p className="aside__empty">这条旁路没有报进度明细，只知道它在跑。</p>
        ) : (
          <LaneTree nodes={nodes} live={active.status === "running"} />
        )}
        {active.summary === undefined ? null : <p className="aside__summary">{active.summary}</p>}
      </div>
    </aside>
  )
}
