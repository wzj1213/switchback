import { useEffect, useRef, useState } from "react"
import { indexAt } from "./EffortSlider.js"
import { effortLabel } from "./ModelPicker.js"

/** 深空态条子上的星点：钉死的五颗，错落闪烁（位置/相位见 app-composer.css）。 */
const STARS: readonly { left: string; delay: string }[] = [
  { left: "16%", delay: "0s" },
  { left: "34%", delay: ".5s" },
  { left: "52%", delay: "1.1s" },
  { left: "68%", delay: ".3s" },
  { left: "84%", delay: "1.4s" },
]

/** 键盘 → 档位位移。0 = 这个键不归滑块管。 */
function deltaOf(key: string, committed: number, total: number): number {
  if (key === "ArrowLeft" || key === "ArrowDown") return -1
  if (key === "ArrowRight" || key === "ArrowUp") return 1
  if (key === "Home") return -committed
  if (key === "End") return total - 1 - committed
  return 0
}

/** 轨道刻度：一档一枚，空着的那几格也看得到，才能数。 */
function Stops({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="effort__stops" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ left: `${String((i / Math.max(1, count - 1)) * 100)}%` }} />
      ))}
    </span>
  )
}

/** 深空态的星点层。 */
function Stars(): React.JSX.Element {
  return (
    <span className="effort__stars" aria-hidden="true">
      {STARS.map((star) => (
        <i key={star.left} style={{ left: star.left, animationDelay: star.delay }} />
      ))}
    </span>
  )
}

/**
 * 推理强度滑块**展开后的那条**。
 *
 * **拖动中只动视觉，松手才提交**：`thread.setModel` 是发给引擎的命令，
 * 拖动过程每帧都发就是在刷引擎。
 *
 * 从 `EffortSlider.tsx` 拆出来是行数闸门逼的：那边是「收起的触发器和接线」，
 * 这边是这条有整套指针/键盘交互的条子。
 */
export function EffortBar({
  efforts,
  committed,
  costly,
  onCommit,
  onClose,
}: {
  efforts: readonly string[]
  committed: number
  /** 落在最贵档：条子进深空态（渐变 + 星点 + 拇指光）。由 `EffortSlider` 算好。 */
  costly: boolean
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
      className={`effort__bar${dragIndex !== undefined ? " effort__bar--live" : ""}`}
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
        const delta = deltaOf(e.key, committed, efforts.length)
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
        {/* 刻度在轨道上、填充之下：空着的那几格也看得到，才能数 */}
        <Stops count={efforts.length} />
        <span
          className="effort__fill"
          style={{ width: `${String((shown / Math.max(1, efforts.length - 1)) * 100)}%` }}
        />
        {costly ? <Stars /> : null}
        <span
          className="effort__thumb"
          style={{ left: `${String((shown / Math.max(1, efforts.length - 1)) * 100)}%` }}
        />
      </span>
      <span className="effort__value">{effortLabel(efforts[shown] ?? "").label}</span>
    </span>
  )
}
