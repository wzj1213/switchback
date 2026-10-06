import type { LaneNode } from "@switchback/protocol"
import { PlanMark, type MarkState } from "./PlanMark.js"
import { compact } from "../usage.js"

/**
 * 旁路的进度树。**内联卡片与工作台共用同一份渲染**——
 * 两处画成两套语言是这个仓库踩过的坑（见 `PlanSteps.tsx` 顶上那句）。
 *
 * 扁平表 ＋ `parent` 缩进就是树形的全部表达，不要再发明第二种：
 * 三家上游给的本来就是扁平的（claude 的 `phaseIndex`、grok 的 `phase`、
 * codex 的 `/root/worker` 路径串），硬拗成嵌套等于替它们做一次都没做的转换。
 */

/** 节点状态 → 那枚共用的环。`failed` 是为旁路加的第五态，见 `PlanMark`。 */
const MARK: Readonly<Record<LaneNode["state"], MarkState>> = {
  pending: "pending",
  running: "in_progress",
  done: "done",
  failed: "failed",
  skipped: "dropped",
}

export function LaneTree({
  nodes,
  live,
}: {
  nodes: readonly LaneNode[]
  /** 这条 lane 还在跑吗。历史快照里的环不许转——转了就是在说一件早就结束的事正在发生。 */
  live: boolean
}): React.JSX.Element {
  return (
    <ul className="lane__tree">
      {nodes.map((node) => (
        <li key={node.id} className={`lane-node${node.parent === undefined ? "" : " lane-node--kid"}`}>
          <span className="lane-node__mark">
            <PlanMark status={MARK[node.state]} spinning={live && node.state === "running"} />
          </span>
          <span className="lane-node__name">{node.label}</span>
          {node.detail === undefined ? null : <span className="lane-node__detail">{node.detail}</span>}
          {node.tokens === undefined ? null : <span className="lane-node__tokens">{compact(node.tokens)}</span>}
        </li>
      ))}
    </ul>
  )
}
