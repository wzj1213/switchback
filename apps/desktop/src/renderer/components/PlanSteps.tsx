import type { PlanStep } from "@switchback/protocol"
import { visibleSteps } from "@switchback/store"
import { PlanMark } from "./PlanMark.js"

const LABEL: Readonly<Record<PlanStep["status"], string>> = {
  pending: "未开始",
  in_progress: "进行中",
  done: "已完成",
  dropped: "已放弃",
}

/**
 * 计划的步骤列。胶囊浮层与正文卡共用——两处必须画成同一套语言。
 * 标记是 `PlanMark` 那枚环；`live=false` 时环不转（历史快照，见 PlanMark）。
 *
 * 做完的划掉——**划线归 done**（待办清单里划掉一条的意思是「做完了」）；
 * dropped 是斜杠环 + 最淡一档 + 不划线，两个状态各有各的独占信号。
 * 线只划字，不划环：一条线穿过标记列会把四态糊成一团。
 */
export function PlanSteps({
  steps,
  max,
  live,
}: {
  steps: readonly PlanStep[]
  max?: number
  /** 是不是活状态。正文里的 PlanCard 是历史快照，传 false。 */
  live: boolean
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
            <span className="plan-step__mark">
              <PlanMark status={step.status} spinning={live && step.status === "in_progress"} />
            </span>
            <span className="plan-step__text">{step.text}</span>
            <span className="sr-only">{LABEL[step.status]}</span>
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
