import type { Item, PlanStep } from "@omni/protocol"
import { openPlan, stepProgressOf } from "@omni/store"

function currentStep(steps: readonly PlanStep[]): PlanStep | undefined {
  return (
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending")
  )
}

/** 手机端只留一行当前进度；完整计划仍在正文时间线里。 */
export function PlanBar({ items }: { items: readonly Item[] }): React.JSX.Element | null {
  const plan = openPlan(items)
  const current = plan === undefined ? undefined : currentStep(plan.steps)
  if (plan === undefined || current === undefined) return null
  const progress = stepProgressOf(plan.steps)
  const label =
    progress.index === undefined
      ? `共 ${String(progress.total)} 步`
      : `第 ${String(progress.index)} / ${String(progress.total)} 步`
  return (
    <aside className="planbar" aria-label="当前计划">
      <span className="planbar__mark" data-status={current.status} aria-hidden="true">
        {current.status === "in_progress" ? "◐" : "○"}
      </span>
      <span className="planbar__progress">{label}</span>
      <span className="planbar__text">{current.text}</span>
    </aside>
  )
}
