import type { EngineGoal, GoalStatus } from "@omni/protocol"
import { compact } from "../usage.js"

const LABEL: Readonly<Record<GoalStatus, string>> = {
  active: "目标进行中",
  paused: "目标已暂停",
  blocked: "目标受阻",
  usage_limited: "用量受限",
  budget_limited: "预算已用尽",
  complete: "目标已完成",
}

function elapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} 秒`
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} 分钟`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${String(hours)} 小时${minutes === 0 ? "" : ` ${String(minutes)} 分钟`}`
}

export function goalDisplay(goal: EngineGoal): { label: string; usage?: string; title: string } {
  const usage = goal.tokenBudget === undefined
    ? (goal.tokensUsed === 0 ? undefined : `已用 ${compact(goal.tokensUsed)}`)
    : `${compact(goal.tokensUsed)} / ${compact(goal.tokenBudget)} tokens`
  const parts = [LABEL[goal.status], goal.objective]
  if (usage !== undefined) parts.push(usage)
  if (goal.timeUsedSeconds > 0) parts.push(`已运行 ${elapsed(goal.timeUsedSeconds)}`)
  return { label: LABEL[goal.status], ...(usage === undefined ? {} : { usage }), title: parts.join(" · ") }
}

/** 引擎原生长期目标：跨轮次常驻，不混进 transcript，也不冒充本轮计划。 */
export function GoalBar({ goal }: { goal: EngineGoal | undefined }): React.JSX.Element | null {
  if (goal === undefined) return null
  const display = goalDisplay(goal)
  return (
    <aside className="goalbar" data-status={goal.status} aria-label={display.title} title={display.title}>
      <span className="goalbar__dot" aria-hidden="true" />
      <span className="goalbar__state">{display.label}</span>
      <span className="goalbar__text">{goal.objective}</span>
      {display.usage === undefined ? null : <span className="goalbar__usage">{display.usage}</span>}
    </aside>
  )
}
