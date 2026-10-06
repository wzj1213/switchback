import type { EngineGoal, GoalStatus } from "@switchback/protocol"

const LABEL: Readonly<Record<GoalStatus, string>> = {
  active: "目标进行中",
  paused: "目标已暂停",
  blocked: "目标受阻",
  usage_limited: "用量受限",
  budget_limited: "预算已用尽",
  complete: "目标已完成",
}

function compact(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  const k = tokens / 1000
  return k < 100 ? `${k.toFixed(1).replace(/\.0$/, "")}k` : `${String(Math.round(k))}k`
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

/** 手机端同样显示宿主落盘的原生目标，不靠 transcript 临时拼。 */
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
