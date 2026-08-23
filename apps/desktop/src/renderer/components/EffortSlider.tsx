import { useEffect, useRef, useState } from "react"
import type { ModelOption } from "@omni/protocol"
import { currentOf, effortLabel } from "./ModelPicker.js"

/**
 * 推理强度的行内滑块。收起时是一段安静的文字加几枚刻度——**不点开也知道
 * 现在在哪一档**；点一下原地长成滑块，拖、点、← → 都能改，Esc 或点别处收起。
 *
 * **只有当前模型报了 `efforts` 才出现**：ACP 那类把强度编进 modelId 的引擎
 * 根本不报——没报就不出现，不是显示一个灰的、点不动的滑块。
 *
 * 它在发送键左边的空地里：条子往左长，空地（弹性槽）吸收宽度，
 * 发送键的 x 一个像素都不动。
 */

/** 指针位置 → 档位序号。纯函数，好测。 */
export function indexAt(x: number, width: number, count: number): number {
  if (count <= 1) return 0
  const pad = 14
  const span = Math.max(1, width - pad * 2)
  const i = Math.round(((x - pad) / span) * (count - 1))
  return Math.min(count - 1, Math.max(0, i))
}

/** 收起态那几枚小刻度：亮到第几格就是第几档，不点开也知道。 */
function Ticks({ count, index }: { count: number; index: number }): React.JSX.Element {
  return (
    <span className="effort__ticks" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i <= index ? "on" : undefined} />
      ))}
    </span>
  )
}

/**
 * 展开后的那条滑块。
 *
 * **拖动中只动视觉，松手才提交**：`thread.setModel` 是发给引擎的命令，
 * 拖动过程每帧都发就是在刷引擎。
 */
function EffortBar({
  efforts,
  committed,
  onCommit,
  onClose,
}: {
  efforts: readonly string[]
  committed: number
  onCommit: (index: number) => void
  /** `refocus` = Esc：焦点还回触发器；点别处收起时不还（焦点跟着那一击走）。 */
  onClose: (refocus: boolean) => void
}): React.JSX.Element {
  const bar = useRef<HTMLSpanElement>(null)
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const shown = dragIndex ?? committed

  // 触发器在展开时已卸载，焦点得主动进条子——不然键盘 ← → 落在 body 上
  useEffect(() => {
    bar.current?.focus()
  }, [])

  // 点别处收起。**pointerdown 不是 click**：先收起的浮层会让那一击落在突然挪位的元素上
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (bar.current?.contains(event.target as Node | null) === true) return
      onClose(false)
    }
    document.addEventListener("pointerdown", onPointer, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer, true)
    }
  }, [onClose])

  const pick = (event: React.PointerEvent<HTMLSpanElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return indexAt(event.clientX - rect.left, rect.width, efforts.length)
  }

  return (
    <span
      ref={bar}
      className="effort__bar"
      role="slider"
      tabIndex={0}
      aria-label="推理强度"
      aria-valuemin={0}
      aria-valuemax={efforts.length - 1}
      aria-valuenow={shown}
      aria-valuetext={effortLabel(efforts[shown] ?? "").label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragIndex(pick(e))
      }}
      onPointerMove={(e) => {
        if (dragIndex !== undefined) setDragIndex(pick(e))
      }}
      onPointerUp={(e) => {
        const index = pick(e)
        setDragIndex(undefined)
        onCommit(index)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onClose(true)
          return
        }
        const delta =
          e.key === "ArrowLeft" || e.key === "ArrowDown"
            ? -1
            : e.key === "ArrowRight" || e.key === "ArrowUp"
              ? 1
              : e.key === "Home"
                ? -committed
                : e.key === "End"
                  ? efforts.length - 1 - committed
                  : 0
        if (delta !== 0) {
          e.preventDefault()
          onCommit(Math.min(efforts.length - 1, Math.max(0, committed + delta)))
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        onClose(false)
      }}
    >
      <span className="effort__range">
        <span
          className="effort__fill"
          style={{ width: `${String((shown / Math.max(1, efforts.length - 1)) * 100)}%` }}
        />
        <span
          className="effort__thumb"
          style={{ left: `${String((shown / Math.max(1, efforts.length - 1)) * 100)}%` }}
        />
      </span>
      <span className="effort__value">{effortLabel(efforts[shown] ?? "").label}</span>
    </span>
  )
}

/** 接线版：从清单里解出当前模型，没解出来（或没报 efforts）就整块不出现。 */
export function BarEffort({
  models,
  model,
  effort,
  disabled,
  onChange,
}: {
  models: readonly ModelOption[]
  model: string | undefined
  effort: string | undefined
  disabled: boolean
  onChange: (model: string, effort: string) => void
}): React.JSX.Element | null {
  const current = currentOf(models, model)
  if (current === undefined) return null
  return (
    <EffortSlider
      current={current}
      effort={effort}
      disabled={disabled}
      onChange={(next) => {
        onChange(current.id, next)
      }}
    />
  )
}

export function EffortSlider({
  current,
  effort,
  disabled,
  onChange,
}: {
  current: ModelOption
  effort: string | undefined
  disabled: boolean
  onChange: (effort: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const trig = useRef<HTMLButtonElement>(null)
  const efforts = current.efforts ?? []
  const value = effort ?? current.defaultEffort ?? efforts[0]
  // 不在清单里的旧值（换过模型）按 0 档画位置、但标签照原文显示——不编一个档位
  const committed = Math.max(0, efforts.indexOf(value ?? ""))
  if (efforts.length === 0) return null
  return (
    <span
      className={`effort${open ? " effort--open" : ""}`}
      style={{ "--effort-w": `${String(28 + efforts.length * 30)}px` } as React.CSSProperties}
    >
      {open ? (
        <EffortBar
          efforts={efforts}
          committed={committed}
          onCommit={(index) => {
            const next = efforts[index]
            if (next !== undefined && index !== committed) onChange(next)
          }}
          onClose={(refocus) => {
            setOpen(false)
            // 触发器要等收起重渲染之后才在
            if (refocus) {
              requestAnimationFrame(() => {
                trig.current?.focus()
              })
            }
          }}
        />
      ) : (
        <button
          type="button"
          ref={trig}
          className="trigger"
          title="推理强度"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => {
            setOpen(true)
          }}
        >
          <Ticks count={efforts.length} index={committed} />
          <span className="trigger__label">{value === undefined ? "默认" : effortLabel(value).label}</span>
        </button>
      )}
    </span>
  )
}
