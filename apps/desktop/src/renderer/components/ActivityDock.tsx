import type { Lane } from "@switchback/protocol"
import { PlanMark } from "./PlanMark.js"
import { ChevronIcon } from "./icons.js"

/** 输入框上方只留正在后台跑的摘要；完整列表永远在右侧工作台。 */
export function ActivityDock({
  lanes,
  onOpen,
}: {
  lanes: readonly Lane[]
  onOpen: (laneId: string) => void
}): React.JSX.Element | null {
  const active = lanes.filter((lane) => lane.status === "running" || lane.status === "paused")
  const latest = active.at(-1)
  if (latest === undefined) return null
  const running = latest.status === "running"
  return (
    <button
      type="button"
      className="activity-dock"
      title={latest.title}
      onClick={() => { onOpen(latest.id) }}
    >
      <span className="activity-dock__mark">
        <PlanMark status={running ? "in_progress" : "pending"} spinning={running} />
      </span>
      <span className="activity-dock__count">后台 {active.length}</span>
      <span className="activity-dock__title">{latest.title}</span>
      <ChevronIcon size={13} />
    </button>
  )
}
