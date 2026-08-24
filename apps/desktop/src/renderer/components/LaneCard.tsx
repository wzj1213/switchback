import type { Lane, LaneNode } from "@omni/protocol"
import { PlanMark, type MarkState } from "./PlanMark.js"
import { compact } from "../usage.js"

/**
 * 一条旁路，画在转录区里。
 *
 * ## 为什么它必须存在
 *
 * `Workflow` 工具**立刻返回**（`Workflow launched in background`），主循环几秒就收工。
 * 于是 `turn` 变成 undefined、`TurnStatus` 整块不渲染，而后台那一批 agent 照跑
 * ——帧全都到了、也进了 store，**没有任何东西渲染它**。这张卡片是那些帧的第一个读者。
 *
 * ## 为什么是内联，不是第三栏
 *
 * 内联拿到八成：后台在干什么终于看得见，而且落盘、⌘R 回得来。
 * 第三栏多买到的是「并排」与「钉住」——那要动布局、Compare 互斥、窄屏覆盖层，
 * 排在后面一批。任何一批出问题，前一批都是可用的（见 `docs/侧栏与引擎状态方案.md` §3）。
 */

/** 节点状态 → 那枚共用的环。`failed` 是为旁路加的第五态，见 `PlanMark`。 */
const MARK: Readonly<Record<LaneNode["state"], MarkState>> = {
  pending: "pending",
  running: "in_progress",
  done: "done",
  failed: "failed",
  skipped: "dropped",
}

const LABEL: Readonly<Record<Lane["status"], string>> = {
  running: "跑着",
  done: "已完成",
  failed: "失败",
}

/** 阶段行（没有 `parent` 的）比 agent 行重一档：它是这棵树的骨架。 */
function Node({ node, live }: { node: LaneNode; live: boolean }): React.JSX.Element {
  const kid = node.parent !== undefined
  return (
    <li className={`lane-node${kid ? " lane-node--kid" : ""}`}>
      <span className="lane-node__mark">
        <PlanMark status={MARK[node.state]} spinning={live} />
      </span>
      <span className="lane-node__name">{node.label}</span>
      {node.detail === undefined ? null : <span className="lane-node__detail">{node.detail}</span>}
      {node.tokens === undefined ? null : <span className="lane-node__tokens">{compact(node.tokens)}</span>}
    </li>
  )
}

export function LaneCard({ lane }: { lane: Lane }): React.JSX.Element {
  const live = lane.status === "running"
  const nodes = lane.progress?.nodes ?? []
  const budget = lane.progress?.budget
  return (
    <section className={`lane lane--${lane.status}`} aria-label={lane.title}>
      <header className="lane__head">
        <span className="lane__mark">
          <PlanMark status={live ? "in_progress" : lane.status === "failed" ? "failed" : "done"} spinning={live} />
        </span>
        <span className="lane__title">{lane.title}</span>
        {/* 节点数是**数出来的**，不是引擎报的一个总数——报的那个可能和列表对不上，
            而两个数字并排出现、其中一个是错的，比只有一个数字糟得多 */}
        {nodes.length === 0 ? null : <span className="lane__count">{nodes.length} 个节点</span>}
        <span className="lane__state">{LABEL[lane.status]}</span>
        {budget === undefined ? null : (
          <span className="lane__budget">
            {compact(budget.used)}
            {budget.total === undefined ? null : ` / ${compact(budget.total)}`}
          </span>
        )}
      </header>
      {/* **报不上来就画转圈，不画一条永远 0% 的进度条。** 一个假的分母比没有分母更糟 */}
      {nodes.length === 0 ? null : (
        <ul className="lane__tree">
          {nodes.map((node) => (
            <Node key={node.id} node={node} live={live && node.state === "running"} />
          ))}
        </ul>
      )}
      {lane.summary === undefined ? null : <p className="lane__summary">{lane.summary}</p>}
    </section>
  )
}
