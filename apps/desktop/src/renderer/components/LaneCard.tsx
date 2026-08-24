import type { Lane } from "@omni/protocol"
import { LaneTree } from "./LaneTree.js"
import { PlanMark } from "./PlanMark.js"
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

const LABEL: Readonly<Record<Lane["status"], string>> = {
  running: "跑着",
  done: "已完成",
  failed: "失败",
}

/** 抬头拆出来是复杂度闸门逼的，但它确实自成一件事：**这条旁路此刻是什么状态**。 */
function LaneHead({ lane, live, nodes }: { lane: Lane; live: boolean; nodes: number }): React.JSX.Element {
  const budget = lane.progress?.budget
  return (
    <header className="lane__head">
      <span className="lane__mark">
        <PlanMark status={live ? "in_progress" : lane.status === "failed" ? "failed" : "done"} spinning={live} />
      </span>
      <span className="lane__title">{lane.title}</span>
      {/* 节点数是**数出来的**，不是引擎报的一个总数——报的那个可能和列表对不上，
          而两个数字并排出现、其中一个是错的，比只有一个数字糟得多 */}
      {nodes === 0 ? null : <span className="lane__count">{nodes} 个节点</span>}
      <span className="lane__state">{LABEL[lane.status]}</span>
      {budget === undefined ? null : (
        <span className="lane__budget">
          {compact(budget.used)}
          {budget.total === undefined ? null : ` / ${compact(budget.total)}`}
        </span>
      )}
    </header>
  )
}

export function LaneCard({
  lane,
  onOpen,
  folded = false,
}: {
  lane: Lane
  /** 点标题在第三栏里打开。缺席就是没有第三栏那一档（对比视图）。 */
  onOpen?: (laneId: string) => void
  /**
   * 第三栏正开着这条时，主线**收成一行**。
   *
   * 不收的话同一棵树在屏幕上出现两遍，而它们还会各自转各自的圈。
   * 收成一行而不是整个藏掉：藏掉之后主线上什么痕迹都没有，
   * 滚回来的人不知道这儿曾经起过一批 agent。
   */
  folded?: boolean
}): React.JSX.Element {
  const live = lane.status === "running"
  const nodes = lane.progress?.nodes ?? []
  return (
    <section className={`lane lane--${lane.status}`} aria-label={lane.title}>
      <LaneHead lane={lane} live={live} nodes={nodes.length} />
      {onOpen === undefined ? null : (
        <button type="button" className="lane__open" onClick={() => { onOpen(lane.id) }}>
          {folded ? "在旁路里看着" : "在旁路查看"}
        </button>
      )}
      {/* **报不上来就画转圈，不画一条永远 0% 的进度条。** 一个假的分母比没有分母更糟 */}
      {folded || nodes.length === 0 ? null : <LaneTree nodes={nodes} live={live} />}
      {folded || lane.summary === undefined ? null : <p className="lane__summary">{lane.summary}</p>}
    </section>
  )
}
