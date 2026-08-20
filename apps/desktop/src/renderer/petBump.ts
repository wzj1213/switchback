import { SIZE, type Bounds, type Pet } from "./pets.js"

/*
 * **两只之间**的事：撞、推、掀翻。
 *
 * 从 `pets.ts` 拆出来是行数闸门逼的，但边界正好：那边一次只看得见一只
 *（`step` 的入参就是一只），这边是唯一一处两只互相知道对方在的地方。
 */

/**
 * 互相撞。**这是唯一一处 pet 与 pet 之间有关系的地方**，所以它没法写进 `step`——
 * 那个函数一次只看得见一只。放在每帧 `step` 之后跑一遍。
 *
 * ## 上一版只做了「动的撞静的」，缺了三样
 *
 * 1. **两只都在飞时互不理睬**：同时甩出去的两只会从对方身上穿过去。
 * 2. **没有分开这一步**：撞上之后两个方盒可以叠在一起，看起来是一只两个头。
 * 3. **速度是按系数发的，不是换的**：撞人的固定剩 45%、被撞的固定拿 70%，
 *    于是轻轻碰一下和用力砸过去，被撞那只飞出去的样子差不多。
 *
 * 现在是正经的等质量碰撞：**沿重叠浅的那条轴交换法向速度**（带恢复系数），
 * 再把两只推开到不重叠。轻轻蹭一下就是蹭一下，用力砸就真能把对方打飞——
 * 差别由速度自己说，不由常数说。
 *
 * ## 正在回窝的那只**没有碰撞体积**
 *
 * 这条不是省事，是必须的：回窝路上还带着体积的话，一只蹦回去的史莱姆会一路
 * 把窝里的撞开，被撞的那只落地又要走回来，回来的路上再撞到别人——
 * **几只就在窝口互相顶着，谁也归不了位**，而 `busy` 因此永远是真，
 * rAF 也就再也停不下来。
 *
 * 于是能撞的只剩两种，都由你直接驱动：**你捏着的那只**（你的手是实的，
 * 撞谁都算数），和**在飞的那只**（你扔的、或者被撞开的）。飞的那只撞不着
 * 正在回窝的——那只已经在让路了。
 *
 * **这一帧里被推过的仍然算数**（`shoved`）：不然拿手里那只去犁一排，
 * 第一只被推开、第二只不认它，一排全叠成一坨。这个标记只活在这一帧。
 */
export function bump(pets: readonly Pet[], bounds: Bounds): readonly Pet[] {
  const shoved = new Set<number>()
  let out: readonly Pet[] = pets
  for (let pass = 0; pass < PASSES; pass += 1) out = sweep(out, shoved, bounds)
  return out
}

/**
 * 扫几遍。**一遍扫不干净**：把 A 从 B 里推出来，可能正好把它推进 C，
 * 而 C 那一对这一帧已经算过了——三只挤在一起时就会出现「越推越进去」。
 *
 * 冲量不会因此发几次：它只在两只**正在互相靠近**时给（`closing > 0`），
 * 而第一遍就把相对速度反过来了，后面几遍剩下的只有「把重叠推开」这一件事。
 */
const PASSES = 3

function sweep(pets: readonly Pet[], shoved: Set<number>, bounds: Bounds): readonly Pet[] {
  const next = [...pets]
  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i]
      const b = next[j]
      if (a === undefined || b === undefined) continue
      if (!meets(a, b) && !shoved.has(i) && !shoved.has(j)) continue
      const touch = contactOf(a, b)
      if (touch === undefined) continue
      const [na, nb] = resolve(a, b, touch, bounds)
      next[i] = na
      next[j] = nb
      shoved.add(i)
      shoved.add(j)
    }
  }
  return next
}

/** 被你捏着的那只是块**石头**：推不动、也不吃速度。于是它能当推土机使。 */
const stone = (p: Pet): boolean => p.mode === "held"

/** **正在回窝的**：走的和蹦的。这两档没有碰撞体积，理由见 `bump`。 */
const homing = (p: Pet): boolean => p.mode === "walk" || p.mode === "hop"

/**
 * 这两只之间有没有碰撞这回事。
 *
 * 你的手是实的（捏着的那只撞谁都算），在飞的撞得着**没在回窝的**那些；
 * 剩下的组合一律穿过去。
 */
function meets(a: Pet, b: Pet): boolean {
  if (stone(a) || stone(b)) return true
  if (a.mode === "air" && !homing(b)) return true
  return b.mode === "air" && !homing(a)
}

/** 撞在哪条轴上、陷进去多深、谁在谁那一侧（`sign` = 1 表示 b 在 a 的正方向）。 */
interface Contact {
  axis: "x" | "y"
  depth: number
  sign: number
}

/**
 * 两个方盒重叠没有。**从重叠浅的那条轴推开**——按深的那条推会把它径直
 * 顶到另一边去，看起来像瞬移。
 */
function contactOf(a: Pet, b: Pet): Contact | undefined {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ox = SIZE - Math.abs(dx)
  const oy = SIZE - Math.abs(dy)
  if (ox <= 0 || oy <= 0) return undefined
  // 正好重合时 `Math.sign` 给 0，会让两只谁也推不开——退化成「b 在正方向」
  if (ox <= oy) return { axis: "x", depth: ox, sign: Math.sign(dx) || 1 }
  return { axis: "y", depth: oy, sign: Math.sign(dy) || 1 }
}

/** 恢复系数。1 = 完全弹开（撞球），0 = 粘住。0.75 是「弹得动，但不会没完」 */
const REST = 0.75
/** 关速小于这个就只是蹭一下：分开就行，不掀翻对方 */
const HIT_MIN = 150
/** 被掀翻的那只顺带被顶起来一点——纯平的横飞看着像冰壶 */
const HIT_UP = 200

/** 沿法向的分量。两条轴各取各的，别的分量原样留着（不是全弹性球，是两个方盒）。 */
const along = (p: Pet, axis: Contact["axis"]): number => (axis === "x" ? p.vx : p.vy)

function resolve(a: Pet, b: Pet, touch: Contact, bounds: Bounds): readonly [Pet, Pet] {
  // 关速：两只**正在互相靠近**的速度。已经在分开就不再给冲量，
  // 否则同一次接触会在连续几帧里反复加速，两只粘在一起抽搐
  const closing = (along(a, touch.axis) - along(b, touch.axis)) * touch.sign
  const kick = closing > 0 ? closing * touch.sign : 0
  /** 这一只承担多少：**都能动就各让一半，撞上石头的自己全担**（等于撞墙）。 */
  const part = (me: Pet, other: Pet): number => (stone(me) ? 0 : stone(other) ? 1 : 0.5)
  const moved = (p: Pet, other: Pet, dir: number): Pet => {
    if (stone(p)) return p
    const k = part(p, other)
    return wake(shove(nudge(p, touch, dir * k, bounds), touch, -dir * kick * k * (1 + REST)), closing)
  }
  return [moved(a, b, 1), moved(b, a, -1)]
}

/**
 * 把陷进去的那点推出来。`share` 是**带符号的份额**：正的往法线的反方向让
 *（法线由 `touch.sign` 定，从 a 指向 b）。
 *
 * **必须乘 `sign`**：不乘的话「b 在 a 左边」时两只会朝着彼此推，越推越进去。
 *
 * **推不进地里，也推不出墙外。** 一只从天上砸到另一只头上时，两边各让一半——
 * 而下面那只脚下就是地，那一半没处让，于是它被按进地下几个像素，
 * 屏幕上就是「摔进去了」。地面是硬的：让不动就是让不动，剩下的重叠由下一遍
 * 扫描去推上面那只（它才是能动的那个）。
 */
function nudge(p: Pet, touch: Contact, share: number, bounds: Bounds): Pet {
  const by = share * touch.sign * touch.depth
  if (touch.axis === "x") return { ...p, x: Math.min(Math.max(p.x - by, 0), bounds.right) }
  return { ...p, y: Math.min(p.y - by, bounds.floor) }
}

/** 沿法向加一份速度。 */
function shove(p: Pet, touch: Contact, dv: number): Pet {
  return touch.axis === "x" ? { ...p, vx: p.vx + dv } : { ...p, vy: p.vy + dv }
}

/**
 * 撞到在地上待着的那只：**把它掀起来**。
 *
 * 蹭一下（关速小）就只把它推开，不顶起来——一脚踹飞的反应配不上一次擦肩。
 *
 * 两档都落到 `air`，**不直接写成 `walk`**：`air` 下一帧会落地，而落地那一段
 * （`arrive`）才知道这一只该走还是该蹦。直接写 `walk` 的话，被轻轻推一下的
 * 史莱姆会**贴着地滑回窝**——而史莱姆是蹦着回去的。
 */
function wake(p: Pet, closing: number): Pet {
  if (p.mode !== "rest" && p.mode !== "walk") return p
  if (closing < HIT_MIN) return { ...p, mode: "air" }
  return { ...p, vy: p.vy - HIT_UP, mode: "air" }
}
