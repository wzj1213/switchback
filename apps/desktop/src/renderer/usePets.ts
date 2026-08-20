import { useCallback, useEffect, useRef, useState } from "react"
import { bump, busy, homeXOf, SIZE, step, type Gait, type Pet, type Stage } from "./pets.js"
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
/** 落地速度低于这个就不演砸扁了——轻轻放下不该抖一下。 */
const LAND_AT = 260

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
  onLand: (index: number, speed: number) => void,
): PetsCtl {
  const area = useRef<HTMLDivElement>(null)
  const nodes = useRef<(HTMLButtonElement | null)[]>([])
  const leans = useRef<(HTMLSpanElement | null)[]>([])
  const shades = useRef<(HTMLSpanElement | null)[]>([])
  const pets = useRef<Pet[]>([])
  // 落地回调放进 ref：它每次渲染都换身份，而 `tick` 不该因此重建
  const land = useRef(onLand)
  land.current = onLand
  const stage = useRef<Stage>({ width: 0, height: 0 })
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
      pets.current = [
        ...bump(
          was.map((pet, i) =>
            step(pet, dt, {
              stage: stage.current,
              homeX: homeXOf(i, count, stage.current.width),
              gait: gaits[i] ?? "walk",
            }),
          ),
        ),
      ]
      // 砸到地上那一下要有反应。**比较前后两帧**是唯一能认出「刚落地」的地方——
      // 物理函数是纯的，它不知道自己是第几帧
      const floor = stage.current.height - SIZE
      for (const [i, now] of pets.current.entries()) {
        const before = was[i]
        if (before !== undefined && before.y < floor && now.y >= floor && before.vy > LAND_AT) {
          land.current(i, before.vy)
        }
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
    for (const [i, pet] of pets.current.entries()) {
      if (pet.mode !== "rest") continue
      pet.x = homeXOf(i, count, stage.current.width)
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

/** 一次小动作。眨眼占多数——瞟眼是「有事发生」的动作，太频繁就成了神经质。 */
const MOODS = ["blink", "blink", "blink", "look-l", "look-r"] as const

/**
 * 随机的小动作：眨眼、往左右瞟一眼。
 *
 * **直接往 DOM 上写类，不走 state。** 眨一次眼要是触发一次 React 重渲染，
 * 这几只每分钟就得把自己重画二三十遍——而它们每帧还在被 rAF 写 transform，
 * 两套更新撞在一起纯属自找。
 *
 * **间隔本身也是随机的**：固定周期的眨眼比不眨还假，人会认出那个节拍。
 */
export function useMood(
  nodes: React.RefObject<(HTMLButtonElement | null)[]>,
  count: number,
  reduced: boolean,
): void {
  useEffect(() => {
    if (reduced || count === 0) return undefined
    let alive = true
    let next: ReturnType<typeof setTimeout>
    let done: ReturnType<typeof setTimeout>
    const again = (): void => {
      next = setTimeout(
        () => {
          if (!alive) return
          const mood = MOODS[Math.floor(Math.random() * MOODS.length)] ?? "blink"
          const node = nodes.current[Math.floor(Math.random() * count)]
          node?.classList.add(`pet--${mood}`)
          done = setTimeout(
            () => {
              if (alive) node?.classList.remove(`pet--${mood}`)
            },
            mood === "blink" ? 130 : 640,
          )
          again()
        },
        2200 + Math.random() * 4200,
      )
    }
    again()
    return () => {
      alive = false
      clearTimeout(next)
      clearTimeout(done)
    }
  }, [nodes, count, reduced])
}

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
