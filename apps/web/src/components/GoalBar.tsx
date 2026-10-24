import type { EngineGoal } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { useLocale } from "../i18n.js"
import { GOAL_BAR } from "./GoalBar.messages.js"

type Text = (typeof GOAL_BAR)[Locale]

function compact(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  const k = tokens / 1000
  return k < 100 ? `${k.toFixed(1).replace(/\.0$/, "")}k` : `${String(Math.round(k))}k`
}

function elapsed(seconds: number, m: Text): string {
  if (seconds < 60) return m.seconds(seconds)
  if (seconds < 3600) return m.minutes(Math.floor(seconds / 60))
  return m.hours(Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60))
}

export function goalDisplay(goal: EngineGoal, locale: Locale): { label: string; usage?: string; title: string } {
  const m = GOAL_BAR[locale]
  const usage = goal.tokenBudget === undefined
    ? (goal.tokensUsed === 0 ? undefined : m.used(compact(goal.tokensUsed)))
    : `${compact(goal.tokensUsed)} / ${compact(goal.tokenBudget)} tokens`
  const parts = [m.status[goal.status], goal.objective]
  if (usage !== undefined) parts.push(usage)
  if (goal.timeUsedSeconds > 0) parts.push(m.ran(elapsed(goal.timeUsedSeconds, m)))
  return { label: m.status[goal.status], ...(usage === undefined ? {} : { usage }), title: parts.join(" · ") }
}

/** 手机端同样显示宿主落盘的原生目标，不靠 transcript 临时拼。 */
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
