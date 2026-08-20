import type { PlanStep } from "@omni/protocol"
import { visibleSteps } from "@omni/store"

const STATUS: Readonly<Record<PlanStep["status"], { mark: string; label: string }>> = {
  pending: { mark: "○", label: "未开始" },
  in_progress: { mark: "◐", label: "进行中" },
  done: { mark: "●", label: "已完成" },
  dropped: { mark: "×", label: "已放弃" },
}

/** 正文卡与常驻面板共用，避免两处把“当前步”画成两套语言。 */
export function PlanSteps({
  steps,
  max,
}: {
  steps: readonly PlanStep[]
  max?: number
}): React.JSX.Element {
  const shown = max === undefined ? steps : visibleSteps(steps, max)
  const hidden = steps.length - shown.length
  const done = steps.filter((step) => step.status === "done").length
  const pending = steps.filter((step) => step.status === "pending").length
  return (
    <div className="plan-steps">
      <ol className="plan-steps__list">
        {shown.map((step, index) => (
          <li className="plan-step" data-status={step.status} key={`${String(index)}-${step.text}`}>
            <span className="plan-step__mark" aria-hidden="true">
              {STATUS[step.status].mark}
            </span>
            <span className="plan-step__text">{step.text}</span>
            <span className="sr-only">{STATUS[step.status].label}</span>
          </li>
        ))}
      </ol>
      {hidden <= 0 ? null : (
        <p className="plan-steps__more">
          … 还有 {hidden} 条（{done} 已完成 · {pending} 未开始）
        </p>
      )}
    </div>
  )
}
