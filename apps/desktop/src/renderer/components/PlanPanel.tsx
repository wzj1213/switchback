import { useEffect, useRef, useState } from "react"
import type { Item, PlanStep } from "@switchback/protocol"
import { openPlan, stepProgressOf } from "@switchback/store"
import { PlanMark } from "./PlanMark.js"
import { PlanSteps } from "./PlanSteps.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { PLAN_PANEL } from "./PlanPanel.messages.js"

type Text = (typeof PLAN_PANEL)[Locale]

function currentStep(steps: readonly PlanStep[]): PlanStep | undefined {
  return (
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending")
  )
}

/**
 * 胶囊上的进度：有当前序号就「3 / 7」，没有就「· 7 步」。
 * `stepProgressOf` 拿不到当前序号时返回的是「共 N 步」——
 * 胶囊认这个分支，不硬凑一个假的当前序号：**引擎没报的东西，Switchback 不替它编。**
 */
function pillLabel(steps: readonly PlanStep[], m: Text): string {
  const progress = stepProgressOf(steps)
  return progress.index === undefined
    ? m.steps(progress.total)
    : `${String(progress.index)} / ${String(progress.total)}`
}

function ariaLabel(steps: readonly PlanStep[], current: PlanStep, m: Text): string {
  const progress = stepProgressOf(steps)
  const where =
    progress.index === undefined
      ? m.total(progress.total)
      : m.at(progress.index, progress.total)
  return m.aria(where, current.text)
}

const WIDE = 330

/** 计划的浮层。预览时 `pointer-events: none`（真入口是点击），钉住才接得住指针。 */
function PlanPop({
  pinned,
  spot,
  steps,
  running,
  onDismiss,
}: {
  pinned: boolean
  spot: { left: number; bottom: number }
  steps: readonly PlanStep[]
  running: boolean
  onDismiss: () => void
}): React.JSX.Element {
  const m = useMessages(PLAN_PANEL)
  return (
    <div
      className={`plan-pop${pinned ? " plan-pop--pinned" : ""}`}
      style={{ left: spot.left, bottom: spot.bottom }}
      {...(pinned ? { role: "dialog" as const, "aria-label": m.current } : { "aria-hidden": "true" as const })}
    >
      <div className="plan-pop__body">
        <PlanSteps steps={steps} max={8} live={running} />
      </div>
      <div className="plan-pop__foot">
        <span>{pinned ? m.escToClose : m.clickToPin}</span>
        {/* 「本会话收起」从常驻按钮降级到这里：它是低频动作，不该在一排常驻胶囊里占一个目标 */}
        <button type="button" className="plan-pop__dismiss" tabIndex={pinned ? 0 : -1} onClick={onDismiss}>
          {m.dismiss}
        </button>
      </div>
    </div>
  )
}

/**
 * 输入框上方的计划：从通栏卡收成一枚胶囊——加载圈 + 步数。
 *
 * - **hover 只是预览**，真入口是点击：点一下钉住（`aria-expanded`），
 *   钉住之后鼠标移开也不收，Esc 或点别处收起。
 * - **环只在真的在跑时转**（`running`）。显示的那一步未必正在跑——
 *   比如卡在等你批的时候；一直转就是在说「它在忙」，而它其实在等你。
 */
export function PlanPanel({
  items,
  running,
}: {
  items: readonly Item[]
  /** 引擎此刻在跑（不是待批、不是启动中）。环只在它上面转。 */
  running: boolean
}): React.JSX.Element | null {
  const m = useMessages(PLAN_PANEL)
  const [pinned, setPinned] = useState(false)
  const [preview, setPreview] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [spot, setSpot] = useState<{ left: number; bottom: number } | undefined>(undefined)
  const timer = useRef(0)
  const box = useRef<HTMLElement>(null)
  const plan = openPlan(items)

  // 钉住才听这两样：Esc 收起、点外面收起。预览态不收——它跟着鼠标走
  useEffect(() => {
    if (!pinned) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault()
        setPinned(false)
        setPreview(false)
      }
    }
    const onPointer = (event: PointerEvent): void => {
      if (box.current?.contains(event.target as Node | null) === true) return
      setPinned(false)
    }
    document.addEventListener("keydown", onKey, true)
    document.addEventListener("pointerdown", onPointer, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      document.removeEventListener("pointerdown", onPointer, true)
    }
  }, [pinned])

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current)
    }
  }, [])

  if (plan === undefined || dismissed) return null
  const current = currentStep(plan.steps)
  if (current === undefined) return null
  const computeSpot = (): void => {
    const rect = box.current?.getBoundingClientRect()
    if (rect === undefined) return
    setSpot({
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - WIDE / 2, window.innerWidth - WIDE - 8)),
      bottom: window.innerHeight - rect.top + 7,
    })
  }
  return (
    <aside className="plan-pillrow" aria-label={m.current} ref={box}>
      <button
        type="button"
        className="plan-pill"
        aria-expanded={pinned || preview}
        aria-label={ariaLabel(plan.steps, current, m)}
        onMouseEnter={() => {
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            computeSpot()
            setPreview(true)
          }, 200)
        }}
        onMouseLeave={() => {
          window.clearTimeout(timer.current)
          if (!pinned) setPreview(false)
        }}
        onClick={() => {
          window.clearTimeout(timer.current)
          computeSpot()
          setPinned(!pinned)
          setPreview(false)
        }}
      >
        <PlanMark status={current.status} spinning={running && current.status === "in_progress"} />
        <span className="plan-pill__n">{pillLabel(plan.steps, m)}</span>
      </button>
      {(pinned || preview) && spot !== undefined ? (
        <PlanPop
          pinned={pinned}
          spot={spot}
          steps={plan.steps}
          running={running}
          onDismiss={() => {
            setDismissed(true)
          }}
        />
      ) : null}
    </aside>
  )
}
