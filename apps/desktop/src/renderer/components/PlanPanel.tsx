import { useState } from "react"
import type { Item, PlanStep } from "@omni/protocol"
import { openPlan, stepProgressOf } from "@omni/store"
import { ChevronIcon } from "./icons.js"
import { PlanSteps } from "./PlanSteps.js"

function currentStep(steps: readonly PlanStep[]): PlanStep | undefined {
  return (
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending")
  )
}

function progressLabel(steps: readonly PlanStep[]): string {
  const progress = stepProgressOf(steps)
  return progress.index === undefined
    ? `共 ${String(progress.total)} 步`
    : `第 ${String(progress.index)} / ${String(progress.total)} 步`
}

/** 输入框上方的常驻计划。没有 open plan 时整个组件不进 DOM。 */
export function PlanPanel({ items }: { items: readonly Item[] }): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const plan = openPlan(items)
  const current = plan === undefined ? undefined : currentStep(plan.steps)
  if (plan === undefined || current === undefined || dismissed) return null
  return (
    <aside className="plan-panel" aria-label="当前计划">
      {expanded ? (
        <div className="plan-panel__body">
          <PlanSteps steps={plan.steps} max={8} />
        </div>
      ) : null}
      <div className="plan-panel__row">
        <button
          className="plan-panel__toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value)
          }}
        >
          <span className="plan-panel__mark" data-status={current.status} aria-hidden="true">
            {current.status === "in_progress" ? "◐" : "○"}
          </span>
          <span className="plan-panel__progress">{progressLabel(plan.steps)}</span>
          <span className="plan-panel__text">{current.text}</span>
          <ChevronIcon open={expanded} />
        </button>
        <button
          className="plan-panel__close"
          type="button"
          aria-label="本会话收起计划"
          title="本会话收起"
          onClick={() => {
            setDismissed(true)
          }}
        >
          ×
        </button>
      </div>
    </aside>
  )
}
