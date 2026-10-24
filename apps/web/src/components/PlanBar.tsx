import type { Item, PlanStep } from "@switchback/protocol"
import { openPlan, stepProgressOf } from "@switchback/store"
import { useMessages } from "../i18n.js"
import { PLAN_BAR } from "./PlanBar.messages.js"

function currentStep(steps: readonly PlanStep[]): PlanStep | undefined {
  return (
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending")
  )
}

/** 手机端只留一行当前进度；完整计划仍在正文时间线里。 */
export function PlanBar({ items }: { items: readonly Item[] }): React.JSX.Element | null {
  const m = useMessages(PLAN_BAR)
  const plan = openPlan(items)
  const current = plan === undefined ? undefined : currentStep(plan.steps)
  if (plan === undefined || current === undefined) return null
  const progress = stepProgressOf(plan.steps)
  const label = progress.index === undefined ? m.total(progress.total) : m.at(progress.index, progress.total)
  return (
    <aside className="planbar" aria-label={m.current}>
      <span className="planbar__mark" data-status={current.status} aria-hidden="true">
        {current.status === "in_progress" ? "◐" : "○"}
      </span>
      <span className="planbar__progress">{label}</span>
      <span className="planbar__text">{current.text}</span>
    </aside>
  )
}
