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

/** 星点位置的种子序列。**位置固定、不随重绘跳动**——跳来跳去会读成「它在闪什么」。 */
function seeded(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * 星点层。
 *
 * 上一版三处不对，是对着截图一条条改的：
 *
 * 1. **数量写死 10 颗**，208px 上摊下来每 20px 才一颗——那不是星空，是几粒灰。
 *    现在按宽度给（`w / 15`），三档模型的短条子也不会显得空。
 * 2. **`t²` 把点全堆在了左边**，而原来的注释写的是「密度往右加」——
 *    平方是把均匀分布压向 0，方向正好写反了。左密其实是对的
 *    （靛蓝那头最深，星点只有在深底上才读成星星），所以保留左密，
 *    但换成 `t^1.6`：右边那截也留几颗，不至于半条空着。
 * 3. **1px 的方块套一个 4px 的白光晕**，读出来是脏点不是星。现在光晕跟着
 *    自己的大小走（CSS 里 `calc(var(--s) * 1.4)`），并且只有每第三颗
 *    才是带芒的四角星（`.lit`），其余是圆点——**一屏里芒星是少数才像星空**。
 */
function Stars({ width }: { width: number }): React.JSX.Element {
  const count = Math.max(9, Math.round(width / 15))
  return (
    <span className="effort__stars" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const t = seeded(i * 4 + 1)
        const size = 1.4 + seeded(i * 4 + 2) * 1.8
        return (
          <i
            key={i}
            className={i % 3 === 1 ? "lit" : undefined}
            style={{
              left: `${String(Math.round(Math.pow(t, 1.6) * (width - 6) + 3))}px`,
              top: `${String(3 + Math.round(seeded(i * 4 + 3) * 19))}px`,
              "--s": `${size.toFixed(1)}px`,
              animationDelay: `${(seeded(i * 4 + 4) * -2.6).toFixed(2)}s`,
            } as React.CSSProperties}
          />
        )
      })}
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
        {costly ? <Stars width={width} /> : null}
      </span>
      <Stops count={efforts.length} />
      <span
        className="effort__thumb"
        style={{ "--tx": `${String(x)}px` } as React.CSSProperties}
      />
    </span>
  )
}
