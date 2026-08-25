import type { Lane } from "@omni/protocol"
import { LaneTree } from "./LaneTree.js"
import { PlanMark, type MarkState } from "./PlanMark.js"
import { compact } from "../usage.js"
import { AsideLaneCard } from "./aside-card.js"

/**
 * 一条旁路，画在转录区里。
 *
 * `Workflow` 工具立刻返回，后台 agent 却还会继续跑；这张卡片是后续帧在主线里的读者。
 * 工作台打开同一条旁路时，主线只收成摘要，不把原始记录藏掉。
 */

const LABEL: Readonly<Record<Lane["status"], string>> = {
  running: "跑着",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
}

const HEAD_MARK: Readonly<Record<Lane["status"], MarkState>> = {
  running: "in_progress",
  paused: "pending",
  done: "done",
  failed: "failed",
}

function statusLabel(status: Lane["status"], live: boolean): string {
  return status === "running" && !live ? "状态待确认" : LABEL[status]
}

/** 抬头自成一件事：说明这条旁路此刻是什么状态。 */
function LaneHead({ lane, live, nodes }: { lane: Lane; live: boolean; nodes: number }): React.JSX.Element {
  const budget = lane.progress?.budget
  const spinning = lane.status === "running" && live
  return (
    <header className="lane__head">
      <span className="lane__mark">
        <PlanMark status={HEAD_MARK[lane.status]} spinning={spinning} />
      </span>
      <span className="lane__title">{lane.title}</span>
      {nodes === 0 ? null : <span className="lane__count">{nodes} 个节点</span>}
      <span className="lane__state">{statusLabel(lane.status, live)}</span>
      {budget === undefined ? null : (
        <span className="lane__budget">
          {compact(budget.used)}
          {budget.total === undefined ? null : ` / ${compact(budget.total)}`}
        </span>
      )}
    </header>
  )
}

interface LaneCardProps {
  lane: Lane
  /** 历史线程里的 running 只是最后快照；没接回引擎前不能继续转圈。 */
  live: boolean
  /** 在工作台打开。缺席就是没有工作台那一档（例如对比视图）。 */
  onOpen?: (laneId: string) => void
  /** 工作台正开着这条时，主线收成一行，避免同一棵树在屏幕上出现两遍。 */
  folded?: boolean
}

export function LaneCard({ lane, live, onOpen, folded = false }: LaneCardProps): React.JSX.Element {
  if (lane.kind === "aside") return <AsideLaneCard lane={lane} live={live} onOpen={onOpen} folded={folded} />
  const nodes = lane.progress?.nodes ?? []
  const spinning = lane.status === "running" && live
  return (
    <section className={`lane lane--${lane.status}`} aria-label={lane.title}>
      <LaneHead lane={lane} live={live} nodes={nodes.length} />
      {onOpen === undefined ? null : (
        <button type="button" className="lane__open" onClick={() => { onOpen(lane.id) }}>
          {folded ? "已在工作台打开" : "在工作台查看"}
        </button>
      )}
      {folded || nodes.length === 0 ? null : <LaneTree nodes={nodes} live={spinning} />}
      {folded || lane.summary === undefined ? null : <p className="lane__summary">{lane.summary}</p>}
    </section>
  )
}
