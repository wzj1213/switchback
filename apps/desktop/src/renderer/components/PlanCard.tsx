import { useState } from "react"
import type { PlanItem } from "@switchback/protocol"
import { stepProgressOf } from "@switchback/store"
import { ChevronIcon } from "./icons.js"
import { PlanSteps } from "./PlanSteps.js"
import { useMessages } from "../i18n.js"
import { PLAN_CARD } from "./PlanCard.messages.js"

/** 正文里的计划快照：默认折起，只负责保留“计划在何时变过”。 */
export function PlanCard({ item }: { item: PlanItem }): React.JSX.Element {
  const m = useMessages(PLAN_CARD)
  const [open, setOpen] = useState(false)
  const progress = stepProgressOf(item.steps)
  const count = m.count(progress.total, progress.done)
  return (
    <div className="run plan-card">
      <button
        className="plan-card__head"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <ChevronIcon open={open} />
        <span className="plan-card__title">{m.title}</span>
        <span className="plan-card__count">· {count}</span>
      </button>
      {open ? (
        <div className="plan-card__body">
          {item.explanation === undefined ? null : (
            <p className="plan-card__note">{item.explanation}</p>
          )}
          <PlanSteps steps={item.steps} live={false} />
        </div>
      ) : null}
    </div>
  )
}
