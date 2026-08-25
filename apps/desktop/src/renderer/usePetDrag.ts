import { useEffect, useRef } from "react"
import { SIZE } from "./pets.js"
import { type PetsCtl } from "./usePets.js"

/**
 * 捏起来、拖走、松手。
 *
 * 从 `Pets.tsx` 拆出来是行数闸门逼的，但边界也顺：那边管画，这边管**摸**。
 *
 * 松手分三种：点了一下（原地蹦一下，纯玩）、甩出去（带着速度进抛物线）、
 * 系统要求少动（直接回窝，不演）。
 */

/** 按下到松手，位移和时长都在这以内才算「点了一下」，否则是拖。 */
const TAP_PX = 4
const TAP_MS = 320

const BOOP: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)" },
  { transform: "translateY(-12px) scale(.9, 1.15)", offset: 0.3 },
  { transform: "translateY(0) scale(1.15, .85)", offset: 0.6 },
  { transform: "translateY(0) scale(1, 1)" },
]
const PEEK: Keyframe[] = [
  { transform: "translateY(0)" },
  { transform: "translateY(-4px)", offset: 0.4 },
  { transform: "translateY(0)" },
]
/** 捏起来那一下。 */
const LIFT: Keyframe[] = [
  { transform: "scale(1, 1)" },
  { transform: "scale(1.22, 0.82)", offset: 0.25 },
  { transform: "scale(0.94, 1.1)", offset: 0.6 },
  { transform: "scale(1.08, 1.02)" },
]

interface Grab {
  index: number
  pointer: number
  /** 指针相对这只左上角的偏移。拖动时保持不变，不然它会跳一下贴到指针上 */
  dx: number
  dy: number
  downAt: number
  moved: boolean
  /** 最近一次采样，用来算甩出去的速度 */
  lastX: number
  lastY: number
  lastAt: number
  vx: number
  vy: number
}

export interface PetDrag {
  down: (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => void
  move: (e: React.PointerEvent<HTMLButtonElement>) => void
  up: (e: React.PointerEvent<HTMLButtonElement>) => void
  /**
   * 指针捕获**没了**。
   *
   * 这一条不是防御性编程，它对应一个真的会发生、而且后果很硬的情况：
   * 捏着一只的时候队伍换了人（换引擎、设置里勾掉一只、只剩一只那一档变了），
   * React 会把那个 `<button>` 卸掉——**`pointerup` 于是永远不来**。
   * 而 `busy()` 把 `held` 算作「在动」，所以那一刻起 rAF 再也不停：
   * 一只钉在半空的桌宠，外加一个天天开着的窗口每秒醒 60 次。
   */
  lost: (e: React.PointerEvent<HTMLButtonElement>) => void
}

export function usePetDrag(
  ctl: PetsCtl,
  /** 身体那一层。捏起来、蹦一下、砸扁都演在它身上。 */
  bodies: React.RefObject<(HTMLSpanElement | null)[]>,
  reduced: boolean,
  /** 座位表。**换了人就松手**，理由见 `PetDrag.lost`。 */
  seats: readonly unknown[],
): PetDrag {
  const grab = useRef<Grab | null>(null)

  const watch = (index?: number): void => {
    look(ctl, index)
  }

  const release = (): void => {
    const g = grab.current
    grab.current = null
    letGoOf(ctl, g)
  }

  // 队伍一换人就松手。**不能等 `pointerup`**：那个节点可能已经不在了。
  // 经 ref 转一道是因为 `release` 每次渲染换身份，直接列进依赖等于每渲染一次松一次手
  const letGo = useRef(release)
  letGo.current = release
  useEffect(
    () => () => {
      letGo.current()
    },
    [seats],
  )

  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const box = ctl.area.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  const held = (e: React.PointerEvent): Grab | undefined => {
    const g = grab.current
    if (g === null || e.pointerId !== g.pointer) return undefined
    return ctl.pets.current[g.index] === undefined ? undefined : g
  }

  const down =
    (index: number) =>
    (e: React.PointerEvent<HTMLButtonElement>): void => {
      const started = pickUp({ ctl, bodies: bodies.current, reduced }, index, e, at(e))
      if (started !== undefined) grab.current = started
    }

  const move = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const g = held(e)
    const pet = g === undefined ? undefined : ctl.pets.current[g.index]
    if (g === undefined || pet === undefined) return
    const p = at(e)
    const x = clamp(p.x - g.dx, 0, ctl.stage.current.width - SIZE)
    const y = clamp(p.y - g.dy, 0, ctl.stage.current.height - SIZE)
    const now = performance.now()
    // 甩出去的速度只取**最近一小段**：取整段的话，「拖过去停一会儿再松手」
    // 也会被算成一次猛甩
    const span = Math.max(1, now - g.lastAt)
    g.vx = ((x - g.lastX) / span) * 1000
    g.vy = ((y - g.lastY) / span) * 1000
    g.lastX = x
    g.lastY = y
    g.lastAt = now
    if (Math.abs(x - pet.x) + Math.abs(y - pet.y) > TAP_PX) g.moved = true
    pet.x = x
    pet.y = y
    // **手里这只也带着速度。** 物理层不会拿它推进位置（`step` 见了 `held` 直接返回），
    // 但碰撞要看它：不带的话，抡着一只去砸另一只和贴着它慢慢蹭是同一个结果
    pet.vx = g.vx
    pet.vy = g.vy
    watch(g.index)
    ctl.paint()
  }

  const up = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const g = held(e)
    const pet = g === undefined ? undefined : ctl.pets.current[g.index]
    if (g === undefined || pet === undefined) return
    grab.current = null
    e.currentTarget.classList.remove("pet--held")
    watch()
    if (!g.moved && performance.now() - g.downAt < TAP_MS) {
      // **点它纯粹是玩**：被点的蹦一下，左右邻居探个头。不换引擎——
      // 换引擎在输入框那颗下拉里，一个玩的动作不该有副作用
      pet.mode = "rest"
      poke(bodies.current, g.index, reduced)
      return
    }
    if (reduced) {
      pet.vx = 0
      pet.vy = 0
      pet.mode = "rest"
      ctl.layout()
      return
    }
    pet.vx = g.vx
    pet.vy = g.vy
    pet.mode = "air"
    ctl.kick()
  }

  const lost = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (grab.current?.pointer !== e.pointerId) return
    release()
  }

  return { down, move, up, lost }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 捏起来那一刻。返回这一次抓的记录；那一格是空的就什么都不做。 */
function pickUp(
  deck: { ctl: PetsCtl; bodies: readonly (HTMLSpanElement | null)[]; reduced: boolean },
  index: number,
  e: React.PointerEvent<HTMLButtonElement>,
  spot: { x: number; y: number },
): Grab | undefined {
  const pet = deck.ctl.pets.current[index]
  if (pet === undefined) return undefined
  e.currentTarget.setPointerCapture(e.pointerId)
  pet.mode = "held"
  // **捏起来要有反应。** 上一版按下去除了位置什么都不变，手上没有「拿住了」
  // 这一下——先被指头压扁一瞬，再弹起来托在手里，那才是抓起一个软东西的样子
  e.currentTarget.classList.add("pet--held")
  if (!deck.reduced) deck.bodies[index]?.animate(LIFT, { duration: 260, easing: "ease-out" })
  // **捏起来就得把帧循环拉起来。** 互相撞只在循环里算（`bump`），
  // 不拉的话手里这只从别人身上推过去毫无反应——它是块能推人的石头，前提是有人在算
  deck.ctl.kick()
  look(deck.ctl, index)
  const now = performance.now()
  return {
    index,
    pointer: e.pointerId,
    dx: spot.x - pet.x,
    dy: spot.y - pet.y,
    downAt: now,
    moved: false,
    lastX: pet.x,
    lastY: pet.y,
    lastAt: now,
    vx: 0,
    vy: 0,
  }
}

/**
 * 你捏起一只时，另外几只**转头看它**——而且跟着看，你把它拖到哪边它们就看哪边。
 * 松手（`index` 给 undefined）清掉。
 *
 * 这是这几只之间唯一一处「互相知道对方在」的地方，也是最便宜的一处：
 * 两个类名，没有新元素、没有新状态。
 */
function look(ctl: PetsCtl, index?: number): void {
  const held = index === undefined ? undefined : ctl.pets.current[index]
  for (const [j, node] of ctl.nodes.current.entries()) {
    if (node === null) continue
    node.classList.remove("pet--look-l", "pet--look-r")
    const me = ctl.pets.current[j]
    if (held === undefined || me === undefined || j === index) continue
    node.classList.add(held.x > me.x ? "pet--look-r" : "pet--look-l")
  }
}

/**
 * 松开手里那只：清掉捏着的标记，让它自己落回去。
 *
 * **不瞬移回窝**——正捏在半空时瞬移看起来是「它没了又冒出来」，
 * 落下去才读得出「手松了」。
 */
function letGoOf(ctl: PetsCtl, g: Grab | null): void {
  if (g === null) return
  const pet = ctl.pets.current[g.index]
  ctl.nodes.current[g.index]?.classList.remove("pet--held")
  look(ctl)
  if (pet === undefined || pet.mode !== "held") return
  pet.mode = "air"
  ctl.kick()
}

/** 用 WAAPI 而不是 CSS 类：连点两下要能重放，而 CSS 动画不会因为类没变就重来。 */
function poke(bodies: readonly (HTMLSpanElement | null)[], index: number, reduced: boolean): void {
  if (reduced) return
  bodies[index]?.animate(BOOP, { duration: 480, easing: "ease" })
  for (const j of [index - 1, index + 1])
    bodies[j]?.animate(PEEK, { duration: 620, easing: "ease" })
}
