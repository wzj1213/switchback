import { useCallback, useEffect, useRef, useState } from "react"
import { bump } from "./petBump.js"
import {
  busy,
  columnRightOf,
  hitOf,
  homeXOf,
  SIZE,
  step,
  type Gait,
  type Hit,
  type Pet,
  type Stage,
} from "./pets.js"
import { paintPets } from "./petPaint.js"

/**
 * 吉祥物的机械部分：量地、推物理、每帧写 transform。
 *
 * 从 `Pets.tsx` 拆出来是行数闸门逼的，但边界也顺：那边管「画成什么样、
 * 被摸的时候怎么反应」，这边管「它们在哪、下一帧在哪」。
 */

/** 一帧最多推进多少秒。切后台再切回来时浏览器会攒出几秒的 dt，
    不夹住的话这一帧的位移能把它送出去好几屏。 */
const MAX_DT = 0.05
/** 读不到 `--content-max` / `--sp-4` 时的兜底。**和 tokens.css 一致**，
    但真走到这儿说明样式没加载，那时位置对不对已经不是最要紧的事了 */
const FALLBACK_MAX = 760
const FALLBACK_PAD = 16

export interface PetsCtl {
  /** 活动区。地面 = 它的底边，也就是输入框的上沿。 */
  area: React.RefObject<HTMLDivElement | null>
  nodes: React.RefObject<(HTMLButtonElement | null)[]>
  /** 倾斜与抻长那一层。见 `petPaint.ts` 里为什么必须分三层。 */
  leans: React.RefObject<(HTMLSpanElement | null)[]>
  /** 钉在地面上的影子——「它离地多高」唯一的说法。 */
  shades: React.RefObject<(HTMLSpanElement | null)[]>
  pets: React.RefObject<Pet[]>
  stage: React.RefObject<Stage>
  /** 把当前坐标写进 DOM。**不走 React**——每帧 setState 会把整棵子树重渲染。 */
  paint: () => void
  /** 有东西要动了，把 rAF 拉起来。已经在跑就什么都不做。 */
  kick: () => void
  /** 量一次活动区，把还在窝里的摆回位。 */
  layout: () => void
}

export function usePets(
  count: number,
  /** 每只怎么回窝。**按序号对齐** `count`，缺的按走路算。 */
  gaits: readonly Gait[],
  /** 挨了一下（砸地、撞墙、撞同伴都算，判据在 `hitOf`）。 */
  onHit: (index: number, hit: Hit) => void,
): PetsCtl {
  const area = useRef<HTMLDivElement>(null)
  const nodes = useRef<(HTMLButtonElement | null)[]>([])
  const leans = useRef<(HTMLSpanElement | null)[]>([])
  const shades = useRef<(HTMLSpanElement | null)[]>([])
  const pets = useRef<Pet[]>([])
  // 回调放进 ref：它每次渲染都换身份，而 `tick` 不该因此重建
  const land = useRef(onHit)
  land.current = onHit
  const stage = useRef<Stage>({ width: 0, height: 0 })
  /** 内容列的右缘。**窝挂在这儿**，而不是活动区的右墙——见 `columnRightOf` */
  const col = useRef(0)
  const frame = useRef<number | undefined>(undefined)
  const clock = useRef(0)

  // 只数变了才补位。**不能整个重建**——重建会把正在空中的那只瞬移回窝
  if (pets.current.length !== count) {
    pets.current = Array.from({ length: count }, (_, i) => pets.current[i] ?? resting())
  }

  const paint = useCallback(() => {
    paintPets(
      { nodes: nodes.current, leans: leans.current, shades: shades.current },
      pets.current,
      stage.current,
    )
  }, [])

  const tick = useCallback(
    (at: number) => {
      const dt = Math.min(MAX_DT, (at - clock.current) / 1000)
      clock.current = at
      const was = pets.current
      // 先各走各的，再统一处理互相撞——`step` 一次只看得见一只
      const moved = was.map((pet, i) =>
        step(pet, dt, {
          stage: stage.current,
          homeX: homeXOf(i, count, col.current),
          gait: gaits[i] ?? "walk",
        }),
      )
      const bounds = { floor: stage.current.height - SIZE, right: stage.current.width - SIZE }
      // **边界要传进去**：互相推的时候地面和墙一样是硬的，
      // 不给的话下面那只会被按进地里（`nudge`）
      pets.current = [...bump(moved, bounds)]
      // 挨了一下就要有反应。判据在 `hitOf`——**比较前后**是唯一能认出
      // 「刚刚撞到了」的地方，物理函数是纯的，它不知道自己是第几帧
      for (const [i, now] of pets.current.entries()) {
        const before = was[i]
        const pushed = moved[i]
        if (before === undefined || pushed === undefined) continue
        const hit = hitOf(before, pushed, now, bounds)
        if (hit !== undefined) land.current(i, hit)
      }
      paint()
      // **没东西在动就停**：一个天天开着的窗口不该为三只静止的史莱姆每秒醒 60 次
      frame.current = busy(pets.current) ? requestAnimationFrame(tick) : undefined
    },
    [count, gaits, paint],
  )

  const kick = useCallback(() => {
    if (frame.current !== undefined) return
    clock.current = performance.now()
    frame.current = requestAnimationFrame(tick)
  }, [tick])

  const layout = useCallback(() => {
    const el = area.current
    if (el === null) return
    stage.current = { width: el.clientWidth, height: el.clientHeight }
    // 从样式里读，不写死：`--content-max` 改了这边要跟着改，而那正是最容易忘的一处
    const style = getComputedStyle(el)
    const max = Number.parseFloat(style.getPropertyValue("--content-max")) || FALLBACK_MAX
    const pad = Number.parseFloat(style.getPropertyValue("--sp-4")) || FALLBACK_PAD
    col.current = columnRightOf(stage.current.width, max, pad)
    for (const [i, pet] of pets.current.entries()) {
      if (pet.mode !== "rest") continue
      pet.x = homeXOf(i, count, col.current)
      pet.y = stage.current.height - SIZE
    }
    paint()
  }, [count, paint])

  useEffect(() => {
    layout()
    const el = area.current
    if (el === null || typeof ResizeObserver === "undefined") return undefined
    const ro = new ResizeObserver(layout)
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [layout])

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return { area, nodes, leans, shades, pets, stage, paint, kick, layout }
}

/** 窝外的初值。第一次 `layout` 会把它摆进窝——在那之前先待在画面外，别闪一下。 */
export const resting = (): Pet => ({ x: -999, y: -999, vx: 0, vy: 0, spin: 0, mode: "rest" })

/** 系统是不是要求少动。**不是读一次就算**：这个开关用户随时会改。 */
export function useReduced(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const on = (e: MediaQueryListEvent): void => {
      setReduced(e.matches)
    }
    mq.addEventListener("change", on)
    return () => {
      mq.removeEventListener("change", on)
    }
  }, [])
  return reduced
}
