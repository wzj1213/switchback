import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { bump } from "./petBump.js"
import {
  busy,
  columnRightOf,
  hitOf,
  SIZE,
  step,
  type Hit,
  type Pet,
  type Stage,
} from "./pets.js"
import { homeOf, measured, reseat, sameSeats, type Seat } from "./pet-seats.js"
import { paintPets } from "./petPaint.js"

/**
 * 吉祥物的机械部分：量地、推物理、每帧写 transform。
 *
 * 从 `Pets.tsx` 拆出来是行数闸门逼的，但边界也顺：那边管「画成什么样、
 * 被摸的时候怎么反应」，这边管「它们在哪、下一帧在哪」。
 *
 * ## 三件事必须在浏览器画之前做完
 *
 * `.pet` 是 `position:absolute; top:0; left:0`，位置**全靠 inline transform**。
 * 于是任何一次「新挂了一个节点、而它身上还没有 transform」的间隙，
 * 那只就实实在在地出现在活动区左上角。`useEffect` 是**画完之后**才跑的，
 * 所以就位这件事只能挂 `useLayoutEffect`：座位表一变，先摆好再让浏览器画。
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
  /** 重新量一次活动区，把还在窝里的摆回位。 */
  layout: () => void
}

export function usePets(
  /** 座位表。**按 key 对齐**，理由见 `pet-seats.ts`。 */
  seats: readonly Seat[],
  /** 挨了一下（砸地、撞墙、撞同伴都算，判据在 `hitOf`）。 */
  onHit: (index: number, hit: Hit) => void,
): PetsCtl {
  const area = useRef<HTMLDivElement>(null)
  const nodes = useRef<(HTMLButtonElement | null)[]>([])
  const leans = useRef<(HTMLSpanElement | null)[]>([])
  const shades = useRef<(HTMLSpanElement | null)[]>([])
  const pets = useRef<Pet[]>([])
  // 回调与座位表都放进 ref：它们每次渲染都换身份，而 `tick` 必须是**稳定**的。
  // 不稳定的话，跑着的那一轮 rAF 仍在调上一版闭包——里面的 `count` 是旧的，
  // 于是换完引擎那几只会走回一个已经不存在的窝
  const land = useRef(onHit)
  land.current = onHit
  const desk = useRef<readonly Seat[]>(seats)
  const stage = useRef<Stage>({ width: 0, height: 0 })
  /** 内容列的右缘。**窝挂在这儿**，而不是活动区的右墙——见 `columnRightOf` */
  const col = useRef(0)
  const frame = useRef<number | undefined>(undefined)
  const clock = useRef(0)

  const paint = useCallback(() => {
    paintPets(
      { nodes: nodes.current, leans: leans.current, shades: shades.current },
      pets.current,
      stage.current,
    )
  }, [])

  /** 还在窝里、或者刚来还没就位的，按当前台面摆好。**量不准就一个都不摆。** */
  const seat = useCallback(() => {
    if (!measured(stage.current)) return
    const count = pets.current.length
    for (const [i, pet] of pets.current.entries()) {
      if (pet.mode !== "rest") continue
      const home = homeOf(i, count, col.current, stage.current)
      pet.x = home.x
      pet.y = home.y
    }
  }, [])

  const tick = useCallback(
    (at: number) => {
      const dt = Math.min(MAX_DT, (at - clock.current) / 1000)
      clock.current = at
      pets.current = advance(pets.current, dt, {
        stage: stage.current,
        col: col.current,
        seats: desk.current,
        onHit: land.current,
      })
      paint()
      // **没东西在动就停**：一个天天开着的窗口不该为三只静止的史莱姆每秒醒 60 次
      frame.current = busy(pets.current) ? requestAnimationFrame(tick) : undefined
    },
    [paint],
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
    if (!measured(stage.current)) return
    // 从样式里读，不写死：`--content-max` 改了这边要跟着改，而那正是最容易忘的一处
    const style = getComputedStyle(el)
    const max = Number.parseFloat(style.getPropertyValue("--content-max")) || FALLBACK_MAX
    const pad = Number.parseFloat(style.getPropertyValue("--sp-4")) || FALLBACK_PAD
    col.current = columnRightOf(stage.current.width, max, pad)
    seat()
    // 窗口一窄，飞在外面的那几只要被拉回来——不拉的话它们在墙外自己弹，
    // 而墙外没有地面，`busy` 于是永远为真
    const pulled = contain(pets.current, stage.current)
    paint()
    if (pulled) kick()
  }, [kick, paint, seat])

  // **座位表一变就立刻重排、就位、写进 DOM**——而且必须在 `useLayoutEffect` 里：
  // 新挂的节点身上还没有 transform，等 `useEffect` 就已经被画过一帧了
  if (!sameSeats(desk.current, seats)) {
    pets.current = reseat(desk.current, pets.current, seats).map((pet) => pet ?? resting())
    desk.current = seats
    trim(nodes.current, leans.current, shades.current, seats.length)
    seat()
  }
  useLayoutEffect(() => {
    seat()
    paint()
  }, [seats, seat, paint])

  // **量地也必须在浏览器画之前。** 这一段原来挂 `useEffect`，那是「画完之后」——
  // 于是刚挂载的那一帧里 `stage` 还是 `{0,0}`，`seat()` 按规矩什么都不摆
  //（见 `measured`），几个按钮身上一个 transform 都没有，全叠在活动区左上角。
  // 只闪一帧，但那一帧正好是开应用、开新会话时你在看的那一帧
  useLayoutEffect(() => {
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
      frame.current = undefined
    },
    [],
  )

  return { area, nodes, leans, shades, pets, stage, paint, kick, layout }
}

interface Field {
  stage: Stage
  /** 内容列的右缘。 */
  col: number
  seats: readonly Seat[]
  onHit: (index: number, hit: Hit) => void
}

/** 推一帧：各走各的、互相撞、报挨了谁。 */
function advance(pets: readonly Pet[], dt: number, field: Field): Pet[] {
  const count = pets.length
  // 先各走各的，再统一处理互相撞——`step` 一次只看得见一只
  const moved = pets.map((pet, i) =>
    step(pet, dt, {
      stage: field.stage,
      homeX: homeOf(i, count, field.col, field.stage).x,
      gait: field.seats[i]?.gait ?? "walk",
    }),
  )
  // **边界要传进去**：互相推的时候地面和墙一样是硬的，
  // 不给的话下面那只会被按进地里（`nudge`）
  const bounds = { floor: field.stage.height - SIZE, right: field.stage.width - SIZE }
  const now = [...bump(moved, bounds)]
  report({ was: pets, moved, now, bounds }, field.onHit)
  return now
}

/**
 * 这一帧谁挨了一下。判据在 `hitOf`——**比较前后**是唯一能认出「刚刚撞到了」
 * 的地方，物理函数是纯的，它不知道自己是第几帧。
 */
interface Pass {
  /** 上一帧。 */
  was: readonly Pet[]
  /** 各走各的之后、互相撞之前。 */
  moved: readonly Pet[]
  /** 这一帧最终的样子。 */
  now: readonly Pet[]
  bounds: { floor: number; right: number }
}

function report(pass: Pass, onHit: (index: number, hit: Hit) => void): void {
  const { was, moved, now, bounds } = pass
  for (const [i, after] of now.entries()) {
    const before = was[i]
    const pushed = moved[i]
    if (before === undefined || pushed === undefined) continue
    const hit = hitOf(before, pushed, after, bounds)
    if (hit !== undefined) onHit(i, hit)
  }
}

/**
 * 把落在台面外的拉回来，返回有没有动过谁。
 *
 * 窗口横向变窄时，站在右边的那几只会整个落到墙外。上一版只重摆 `rest` 的那些，
 * 于是一只正飞着的会留在墙外——那里没有地面，它永远落不下来，
 * `busy` 也就永远为真，rAF 再不停下。
 */
function contain(pets: Pet[], stage: Stage): boolean {
  const right = Math.max(0, stage.width - SIZE)
  const floor = Math.max(0, stage.height - SIZE)
  let touched = false
  for (const pet of pets) {
    const x = Math.min(Math.max(pet.x, 0), right)
    const y = Math.min(Math.max(pet.y, 0), floor)
    if (x === pet.x && y === pet.y) continue
    pet.x = x
    pet.y = y
    if (pet.mode === "rest") continue
    touched = true
  }
  return touched
}

/** 座位少了之后，多出来的那几格引用要抹掉——留着的话 `useMood` 还会往上加类。 */
function trim(
  nodes: (HTMLButtonElement | null)[],
  leans: (HTMLSpanElement | null)[],
  shades: (HTMLSpanElement | null)[],
  count: number,
): void {
  nodes.length = count
  leans.length = count
  shades.length = count
}

/**
 * 窝外的初值。
 *
 * **不再是 `-999`**：那个值的前提是「反正马上会被 `layout` 摆进窝」，
 * 而当台面还没量准时 `layout` 什么都不做（见 `measured`），于是它就留在了
 * 屏幕外。现在新来的那只由 `seat()` 在**同一次渲染里**就位，
 * 这个初值只是「还没量到台面」那一瞬间的样子——`0,0` 至少在活动区里。
 */
export const resting = (): Pet => ({ x: 0, y: 0, vx: 0, vy: 0, spin: 0, mode: "rest" })
