import type { EngineGoal } from "@switchback/protocol"
import { compact } from "../usage.js"
import type { Locale } from "@switchback/i18n"
import { useLocale } from "../i18n.js"
import { GOAL_BAR } from "./GoalBar.messages.js"


function elapsed(seconds: number, m: (typeof GOAL_BAR)[Locale]): string {
  if (seconds < 60) return m.seconds(seconds)
  if (seconds < 3600) return m.minutes(Math.floor(seconds / 60))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return m.hours(hours, minutes)
}

export function goalDisplay(goal: EngineGoal, locale: Locale): { label: string; usage?: string; title: string } {
  const m = GOAL_BAR[locale]
  const label: string = m.status[goal.status]
  const usage = goal.tokenBudget === undefined
    ? (goal.tokensUsed === 0 ? undefined : m.used(compact(goal.tokensUsed)))
    : `${compact(goal.tokensUsed)} / ${compact(goal.tokenBudget)} tokens`
  const parts = [label, goal.objective]
  if (usage !== undefined) parts.push(usage)
  if (goal.timeUsedSeconds > 0) parts.push(m.ran(elapsed(goal.timeUsedSeconds, m)))
  return { label, ...(usage === undefined ? {} : { usage }), title: parts.join(" · ") }
}

/** 引擎原生长期目标：跨轮次常驻，不混进 transcript，也不冒充本轮计划。 */
export function GoalBar({ goal }: { goal: EngineGoal | undefined }): React.JSX.Element | null {
  const locale = useLocale()
  if (goal === undefined) return null
  const display = goalDisplay(goal, locale)
  return (
    <aside className="goalbar" data-status={goal.status} aria-label={display.title} title={display.title}>
      <span className="goalbar__dot" aria-hidden="true" />
      <span className="goalbar__state">{display.label}</span>
      <span className="goalbar__text">{goal.objective}</span>
      {display.usage === undefined ? null : <span className="goalbar__usage">{display.usage}</span>}
    </aside>
  )
}
