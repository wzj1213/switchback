import { useEffect, useRef, useState } from "react"
import { barWidth, indexAt, PAD, THUMB, travelOf } from "./effort-geometry.js"
import { effortLabel } from "./ModelPicker.js"
import { Stars } from "./effort-stars.js"
import { grip } from "./effort-pointer.js"

/**
 * 推理强度滑块**展开后的那条**——布局照比稿那版行内条（gbar）：
 *
 * - 白拇指**边拖边走**（`--tx` 走 translateX，不碰 left——合成器的事，不排版），
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
function deltaOf(key: string, current: number, total: number): number {
  if (key === "ArrowLeft" || key === "ArrowDown") return -1
  if (key === "ArrowRight" || key === "ArrowUp") return 1
  if (key === "Home") return -current
  if (key === "End") return total - 1 - current
  return 0
}

/** 轨道刻度：一档一枚，空着的那几格也看得到，才能数。落点和拇指中心一致。 */
function Stops({ count }: { count: number }): React.JSX.Element {
  const travel = travelOf(barWidth(count))
  return (
    <span className="effort__stops" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{ left: `${String(PAD + (i / Math.max(1, count - 1)) * travel + THUMB / 2)}px` }}
        />
      ))}
    </span>
  )
}

/**
 * 固定在右端的小牌子：**现在是哪一档**。
 *
 * 展开之后触发器被条子顶掉了，档位名也跟着没了；这一枚把那句话补回来。
 *
 * **锚在右边不锚在左边**：外壳的 `max-width` 从收起态张到整条宽要 240ms，
 * 而条子是 `justify-content: flex-end` 的——**右缘一直不动，左缘在跑**。
 * 从左边算的话，展开那一下牌子会横着漂一段。
 *
 * 它也不能挂在条子里面：条子有 `clip-path`，挂进去会被连牌子一起裁掉。
 */
function Now({
  label,
  grown,
}: {
  label: string
  grown: boolean
}): React.JSX.Element {
  const cls = ["effort__now", grown ? "effort__now--in" : ""]
  return (
    <span className={cls.filter(Boolean).join(" ")} aria-hidden="true">
      {label}
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

/**
 * 条子的出场与退场。
 *
 * - `grown`：挂载时 `clip-path` 还是收着的，rAF 之后才张开——**那一下才是「长出来」**；
 * - `intro`：展开那 300ms 里拇指和填充从最左跟着条子一起走；
 * - 点别处收起用 **`pointerdown` 不是 `click`**：先收起的浮层会让那一击
 *   落在突然挪位的元素上。
 */
function useBarLife(
  bar: React.RefObject<HTMLSpanElement | null>,
  onClose: (refocus: boolean) => void,
): { grown: boolean; intro: boolean } {
  const [grown, setGrown] = useState(false)
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    bar.current?.focus()
    const raf = requestAnimationFrame(() => {
      setGrown(true)
    })
    const done = window.setTimeout(() => {
      setIntro(false)
    }, 340)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(done)
    }
  }, [bar])
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (bar.current?.contains(event.target as Node | null) === true) return
      onClose(false)
    }
    document.addEventListener("pointerdown", onPointer, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer, true)
    }
  }, [bar, onClose])
  return { grown, intro }
}

export function EffortBar({
  efforts,
  committed,
  costly,
  onCommit,
  onPreview,
  onClose,
}: {
  efforts: readonly string[]
  committed: number
  /** 落在最贵档：条子进深空态（渐变坡道 + 星点 + 拇指光）。由 `EffortSlider` 算好。 */
  costly: boolean
  onCommit: (index: number) => void
  /**
   * 拖动中指着哪一档。**发的是视觉预览，不是命令**——
   * 深空那套特效得跟着手指走（拖到 ultra 就该看见 ultra 的样子），
   * 而 `thread.setModel` 仍然只在松手那一下发一次。
   */
  onPreview: (effort: string | undefined) => void
  /** `refocus` = Esc：焦点还回触发器；点别处收起时不还（焦点跟着那一击走）。 */
  onClose: (refocus: boolean) => void
}): React.JSX.Element {
  const bar = useRef<HTMLSpanElement>(null)
  const active = useRef<number | undefined>(undefined)
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  /** 已发给引擎、还没等到最终回声的落点；连续按方向键时下一步从这里算。 */
  const [pendingIndex, setPendingIndex] = useState<number | undefined>(undefined)
  const { grown, intro } = useBarLife(bar, onClose)
  // 拖动中画手指位置，松手后守住本地落点，最终再交给引擎回声。
  const shown = dragIndex ?? pendingIndex ?? committed

  useEffect(() => {
    // 只在回声追到最终本地落点时撤；较早的一次回声不能把连续点击拉回去。
    setPendingIndex((pending) => (pending === committed ? undefined : pending))
  }, [committed])

  const width = barWidth(efforts.length)
  const t = (shown / Math.max(1, efforts.length - 1)) * (grown ? 1 : 0)
  const x = PAD + t * travelOf(width)

  /** 拖到哪儿，视觉就跟到哪儿。位置和特效走同一次更新，不会各说各的。 */
  const drag = (index: number | undefined): void => {
    setDragIndex(index)
    onPreview(index === undefined ? undefined : efforts[index])
  }

  /**
   * 落档。**预览留在松手那一档，不清空**——`onCommit` 发出去的是命令，
   * 要等引擎回声才改到 `thread.effort`；中间那一小段里清掉预览的话，
   * 深空特效会闪一下灰再亮回来。预览由 `EffortSlider` 在回声到达时撤。
   */
  const commit = (index: number): void => {
    setPendingIndex(index)
    onPreview(efforts[index])
    onCommit(index)
  }

  const pick = (event: React.PointerEvent<HTMLSpanElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return indexAt(event.clientX - rect.left, rect.width, efforts.length)
  }

  return (
    <>
      <Now
        label={effortLabel(efforts[shown] ?? "").label}
        grown={grown}
      />
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
        {...grip({ active, pick, onDrag: drag, onCommit: commit })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            onClose(true)
            return
          }
          const delta = deltaOf(e.key, shown, efforts.length)
          if (delta !== 0) {
            e.preventDefault()
            commit(Math.min(efforts.length - 1, Math.max(0, shown + delta)))
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          onClose(false)
        }}
      >
        {/* 填充盖过拇指右缘再多出一个 `PAD`：满档时正好铺满整条。
          少那 4px 的话最右会剩一条没填上的浅色缝，读起来像没到头 */}
        <span className="effort__fill" style={{ width: `${String(x + THUMB + PAD)}px` }}>
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
    </>
  )
}
