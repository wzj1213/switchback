import { useEffect, useRef, useState } from "react"
import { barWidth, indexAt, THUMB } from "./EffortSlider.js"
import { effortLabel } from "./ModelPicker.js"

/**
 * 推理强度滑块**展开后的那条**——布局照比稿那版行内条（gbar）：
 *
 * - 白拇指**边走边走**（`--tx` 走 translateX，不碰 left——合成器的事，不排版），
 *   填充盖到拇指右缘，满档时正好铺满整条；
 * - 坡道图层钉在整条的坐标上（宽度取整条宽），跟着填充宽度缩放的话，
 *   拖到一半右端已经是满色，读起来像「已经到头了」；
 * - 展开那一下拇指从最左把条子**拽开**（intro 的 300ms），不是条子露出一个静止的拇指；
 * - 拖动中（`--live`）位移零过渡、1:1 跟手；过渡只留给收得住的瞬间
 *  （展开、点选落档）。过渡追一个每帧都在跑的目标就是拖尾巴。
 *
 * **拖动中只动视觉，松手才提交**：`thread.setModel` 是发给引擎的命令，
 * 拖动过程每帧都发就是在刷引擎。
 */

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
  const w = barWidth(count)
  return (
    <span className="effort__stops" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ left: `${String((i / Math.max(1, count - 1)) * (w - THUMB) + THUMB / 2)}px` }} />
      ))}
    </span>
  )
}

/** 深空态的星点层。位置固定、不随重绘跳动，相位错落（值见 app-composer.css）。 */
function Stars(): React.JSX.Element {
  return (
    <span className="effort__stars" aria-hidden="true">
      {[
        { left: "16%", delay: "0s" },
        { left: "34%", delay: ".5s" },
        { left: "52%", delay: "1.1s" },
        { left: "68%", delay: ".3s" },
        { left: "84%", delay: "1.4s" },
      ].map((star) => (
        <i key={star.left} style={{ left: star.left, animationDelay: star.delay }} />
      ))}
    </span>
  )
}

/** 外壳的 class。intro = 展开那一下；live = 拖动中。 */
function barClass(grown: boolean, intro: boolean, live: boolean): string {
  return [
    "effort__bar",
    grown ? "effort__bar--grown" : "",
    intro ? "effort__bar--intro" : "",
    live ? "effort__bar--live" : "",
  ]
    .filter(Boolean)
    .join(" ")
}

export function EffortBar({
  efforts,
  committed,
  costly,
  onCommit,
  onClose,
}: {
  efforts: readonly string[]
  committed: number
  /** 落在最贵档：条子进深空态（渐变坡道 + 星点 + 拇指光）。由 `EffortSlider` 算好。 */
  costly: boolean
  onCommit: (index: number) => void
  /** `refocus` = Esc：焦点还回触发器；点别处收起时不还（焦点跟着那一击走）。 */
  onClose: (refocus: boolean) => void
}): React.JSX.Element {
  const bar = useRef<HTMLSpanElement>(null)
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  // grown：挂载时 clip-path 还是收着的，rAF 之后张开——那一下才是「长出来」
  const [grown, setGrown] = useState(false)
  // intro：展开那 300ms 里拇指和填充从最左跟着条子一起走
  const [intro, setIntro] = useState(true)
  const shown = dragIndex ?? committed

  useEffect(() => {
    bar.current?.focus()
    const raf = requestAnimationFrame(() => { setGrown(true) })
    const done = window.setTimeout(() => { setIntro(false) }, 340)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(done) }
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

  const width = barWidth(efforts.length)
  const t = (shown / Math.max(1, efforts.length - 1)) * (grown ? 1 : 0)
  const x = t * (width - THUMB)

  const pick = (event: React.PointerEvent<HTMLSpanElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return indexAt(event.clientX - rect.left, rect.width, efforts.length)
  }

  return (
    <span
      ref={bar}
      className={barClass(grown, intro, dragIndex !== undefined)}
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
      <span className="effort__fill" style={{ width: `${String(x + THUMB)}px` }}>
        <span className="effort__lay effort__base" />
        <span className="effort__lay effort__hot" />
        {costly ? <Stars /> : null}
      </span>
      <Stops count={efforts.length} />
      <span
        className="effort__thumb"
        style={{ "--tx": `${String(x)}px` } as React.CSSProperties}
      />
    </span>
  )
}
