import type { EngineId } from "@omni/protocol"

/**
 * 输入框上沿那几只。**纯逻辑那一半**：谁长什么样、松手之后怎么动。
 *
 * 抽出来不是为了好看，是因为这里面每一条都是**手感**，而手感只能靠数值调；
 * 数值写在组件里就只能靠开着 app 反复试，写在这儿至少能被钉住
 *（`pets.test.ts` 钉的是「会落地、会走回去、不会飞出去」这三件事，
 * 不是具体的重力值——那个本来就该随便调）。
 *
 * ## 为什么它们值得存在
 *
 * omni 的立意是「一个界面统一驱动各家引擎」，而「此刻是谁在答」在界面上
 * 一直只由输入框最底下那颗下拉说。三只蹲在输入框上沿，是**把这件事画出来**：
 * 谁亮着就是谁在跑。顺带它是这个界面里唯一一处纯粹的玩意儿——
 * 一个天天开着的工具有一处不办正事的地方，不是浪费。
 */

/** 一只的形。原案就三种搭配，别再发明第四种。 */
export type PetShape = "slime" | "crab"

/** 怎么回窝。**螃蟹走，史莱姆蹦**——它们本来就不是一种走法。 */
export type Gait = "walk" | "hop"

export interface PetLook {
  shape: PetShape
  /** 配色的名字，落到 CSS 的 `.pet--<tone>`。**颜色不进 tokens.css**，见 pets.css。 */
  tone: "kimi" | "claude" | "grok" | "plain"
}

/**
 * 引擎 id → 长什么样。
 *
 * **认不出的一律给素色史莱姆。** 引擎注册表是开放的（`main/engines.ts` 读用户
 * 自己写的 json），所以「没见过的那一家」不是异常而是常态；给它留个空位、
 * 或者临时编一个配色，都比一只统一的素史莱姆差——前者是个洞，后者会撞色。
 *
 * 匹配用**前缀**而不是全等：同一家常有 `claude` / `claude-code` / `claude-sdk`
 * 几个 id，而它们是同一只螃蟹。
 */
const KNOWN: readonly { prefix: string; look: PetLook }[] = [
  { prefix: "kimi", look: { shape: "slime", tone: "kimi" } },
  { prefix: "claude", look: { shape: "slime", tone: "claude" } },
  { prefix: "grok", look: { shape: "slime", tone: "grok" } },
]

/** 这只怎么回窝。形定的：螃蟹横着蹭回去，史莱姆一路弹回去。 */
export function gaitOf(shape: PetShape): Gait {
  return shape === "crab" ? "walk" : "hop"
}

export function lookOf(engine: EngineId): PetLook {
  const id = engine.toLowerCase()
  return KNOWN.find((k) => id.startsWith(k.prefix))?.look ?? { shape: "slime", tone: "plain" }
}

/** 一只占的方格。螃蟹是扁的，但**物理上按同一个方盒算**——不然三只的落地高度不一样。 */
export const SIZE = 30
/** 窝与窝之间。 */
export const SLOT = 44
/** 最右边那只离右墙多远。 */
export const EDGE = 26

/**
 * 内容列的右缘。**窝挂在这条边上，不是活动区的右墙。**
 *
 * 转录区和输入框都是 `--content-max`（760）居中的，而活动区是整个主栏。
 * 窗口窄的时候两条边重合，看不出区别；一拉宽，**输入框还在中间 760，
 * 而窝跟着右墙跑到了卡片外面**——那几只就站到了空气里。
 *
 * `pad` 是输入区的横向内边距（`.composer` 的 `--sp-4`）：内容列最宽也只能
 * 占到活动区减掉这两边。
 */
export function columnRightOf(width: number, max: number, pad: number): number {
  return (width + Math.min(max, width - pad * 2)) / 2
}

/** 第 index 只的窝在哪。从内容列的右缘往左排，顺序和引擎清单一致。 */
export function homeXOf(index: number, count: number, right: number): number {
  return right - EDGE - (count - index) * SLOT + (SLOT - SIZE) / 2
}

/** 一只的运动状态。坐标是**左上角**，相对活动区。 */
export interface Pet {
  x: number
  y: number
  vx: number
  vy: number
  /** 姿态角（度）。被甩出去时跟着横速累积，落地之后转回来。 */
  spin: number
  /**
   * - `rest` 待在窝里
   * - `held` 你正捏着
   * - `air` 你甩出去的，**落地会弹**
   * - `hop` 它自己蹦的一跳，**落地不弹**（自己起跳的那一下不该再颠一下）
   * - `walk` 落地了正横着走回窝
   */
  mode: "rest" | "held" | "air" | "hop" | "walk"
}

export interface Stage {
  width: number
  height: number
}

/** 这一帧的外部条件：地多大、窝在哪、它是走还是蹦。**打包成一个**是因为
    它们总是一起变，分开传会让 `step` 的参数表长到没人愿意读。 */
export interface World {
  stage: Stage
  homeX: number
  gait: Gait
}

/* 手感常数。都可以随便调，测试钉的是行为不是这些数。 */
/** 重力。1800 大约是「从对话框顶上掉到底要小半秒」——再慢就像在水里 */
const G = 1800
/** 弹一下还剩多少速度。0.34 是「弹两下就停」 */
const BOUNCE = 0.34
/** 竖直速度低于这个就别弹了，不然末尾会抖出十几次几乎看不见的微弹 */
const SETTLE = 130
/** 落地那一下横向要吃掉多少：不吃的话它会贴着地一路滑出去，像踩在冰上 */
const SKID = 0.55
/** 撞墙反弹。比地面软——墙是竖的，弹太多看起来像在打乒乓 */
const WALL = 0.42
/** 走回窝的速度。慢到能看出「它在走回去」，快到不会让人等 */
const WALK = 105
/** 蹦一下能蹦多高（初速）。0.37 秒一个来回——再高就成了跳远比赛 */
const HOP_VY = 330
/** 蹦一下最多往前多少（横向速度上限）。一跳约 60px，三四跳到家 */
const HOP_VX = 165
/** 离窝这么近就算到了。比一跳的距离小得多，所以最后一跳一定落在窝里 */
const NEAR = 1.5
/** 横速换成转速的系数。0.55 大约是「用力甩一下转一圈半」——够看出在翻，又不至于晕 */
const SPIN_K = 0.55
/** 转得比这慢就别转了：轻轻放下不该歪着落地 */
const SPIN_MIN = 240
/** 落地之后每帧留多少姿态角。0.8 大约 150ms 转正，比弹跳停得快一点——
 **先站直，再走回去**，反过来看着像瘸了 */
const SPIN_DECAY = 0.8

/**
 * 推进一帧。**纯函数**：给同样的输入永远给同样的输出，不碰 DOM、不读时钟。
 *
 * `dt` 由调用方给（秒）。切后台再切回来时浏览器会攒出一个巨大的 dt，
 * 调用方负责夹住它——不夹的话这一帧的位移能把它送出屏幕外好几屏。
 */
export function step(pet: Pet, dt: number, world: World): Pet {
  if (pet.mode === "rest" || pet.mode === "held") return pet
  const floor = world.stage.height - SIZE
  return pet.mode === "walk" ? stroll(pet, dt, world.homeX, floor) : fly(pet, dt, world, floor)
}

/**
 * 横着走回窝。**螃蟹专用**——史莱姆是一路弹回去的（见 `gaitOf`）。
 *
 * 姿态没转正就先别歇：到家了也在原地把自己转直，那几帧看着像站稳。
 */
function stroll(pet: Pet, dt: number, homeX: number, floor: number): Pet {
  const spin = Math.abs(pet.spin) < 1 ? 0 : pet.spin * SPIN_DECAY
  const gap = homeX - pet.x
  const move = WALK * dt
  if (Math.abs(gap) <= move) {
    return { x: homeX, y: floor, vx: 0, vy: 0, spin, mode: spin === 0 ? "rest" : "walk" }
  }
  return { ...pet, x: pet.x + Math.sign(gap) * move, y: floor, spin }
}

/** 在空中：重力、两面墙、天花板，然后看落没落地。 */
function fly(pet: Pet, dt: number, world: World, floor: number): Pet {
  // 翻滚只在真被甩出去时发生：慢速下落不转，不然轻轻放一下它也歪
  const spin = Math.abs(pet.vx) < SPIN_MIN ? pet.spin * SPIN_DECAY : pet.spin + pet.vx * SPIN_K * dt
  const vy0 = pet.vy + G * dt
  const hit = contain(
    { x: pet.x + pet.vx * dt, y: pet.y + vy0 * dt, vx: pet.vx, vy: vy0 },
    world.stage.width - SIZE,
  )

  if (hit.y < floor) return { ...hit, spin, mode: pet.mode }
  // **只有被甩出去的才弹。** 它自己蹦的那一下落地就该停——一个自己起跳的东西
  // 落地还颠一下，看起来是摔的不是跳的
  if (pet.mode === "air" && hit.vy >= SETTLE) {
    return { x: hit.x, y: floor, vx: hit.vx * SKID, vy: -hit.vy * BOUNCE, spin, mode: "air" }
  }
  return arrive({ x: hit.x, y: floor, spin }, world.homeX, world.gait)
}

/** 一只在飞的样子：位置加速度。`contain` 收进来的也是这个形状。 */
interface Flight {
  x: number
  y: number
  vx: number
  vy: number
}

/** 关在活动区里。**先夹再反弹**，顺序反过来会让它嵌在墙里抖。 */
function contain(f: Flight, right: number): Flight {
  // 顶：拖上去松手时可能带着向上的速度，别让它飞出活动区
  const up = f.y < 0 ? { y: 0, vy: Math.abs(f.vy) * WALL } : { y: f.y, vy: f.vy }
  if (f.x < 0) return { ...up, x: 0, vx: Math.abs(f.vx) * WALL }
  if (f.x > right) return { ...up, x: right, vx: -Math.abs(f.vx) * WALL }
  return { ...up, x: f.x, vx: f.vx }
}

/** 停稳在地面上的那一刻：到家就歇着，没到家就按自己的步态继续。 */
function arrive(spot: { x: number; y: number; spin: number }, homeX: number, gait: Gait): Pet {
  const { x, y, spin } = spot
  const home = Math.abs(homeX - x) <= NEAR
  // 到家但还歪着：交给 `walk` 那一支，它会在原地把姿态转正再歇
  if (home && Math.abs(spin) < 1) return { x: homeX, y, vx: 0, vy: 0, spin: 0, mode: "rest" }
  if (home || gait === "walk") return { x, y, vx: 0, vy: 0, spin, mode: "walk" }
  // 一跳的滞空时间是固定的，所以**最后一跳按剩下的距离算横速**，
  // 正好落在窝里——不然它会在窝口来回蹦过头
  const air = (2 * HOP_VY) / G
  const gap = homeX - x
  const vx = Math.abs(gap) / air < HOP_VX ? gap / air : Math.sign(gap) * HOP_VX
  return { x, y, vx, vy: -HOP_VY, spin, mode: "hop" }
}

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
 * ## 两只都在地上蹭的时候，让它们互相穿过去
 *
 * 不是偷懒：两只走回窝的路上互相推，**谁也走不到自己的窝**，
 * 而 `busy` 会因此永远是真——rAF 就再也停不下来了。有一只在飞（或者被你捏着）
 * 才算数，那时候能量是会衰减的，撞几下总会停。
 *
 * **但这一帧里被推过的那只算「动着」**（`shoved`）：不然拿手里那只去犁一排，
 * 第一只被推开、第二只不认它，一排全叠在一起变成一坨。
 * 这个标记只活在这一帧、也只从「飞的/被捏着的」那里传下去，
 * 所以上面那条「走路的互相穿过去」仍然成立，不会推回去。
 */
export function bump(pets: readonly Pet[]): readonly Pet[] {
  const shoved = new Set<number>()
  let out: readonly Pet[] = pets
  for (let pass = 0; pass < PASSES; pass += 1) out = sweep(out, shoved)
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

function sweep(pets: readonly Pet[], shoved: Set<number>): readonly Pet[] {
  const next = [...pets]
  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i]
      const b = next[j]
      if (a === undefined || b === undefined) continue
      if (!quick(a) && !quick(b) && !shoved.has(i) && !shoved.has(j)) continue
      const touch = contactOf(a, b)
      if (touch === undefined) continue
      const [na, nb] = resolve(a, b, touch)
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

/** 快的那几档。两只都不在这几档里就互相穿过去，理由见 `bump`。 */
const quick = (p: Pet): boolean => p.mode === "air" || p.mode === "hop" || p.mode === "held"

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

function resolve(a: Pet, b: Pet, touch: Contact): readonly [Pet, Pet] {
  // 关速：两只**正在互相靠近**的速度。已经在分开就不再给冲量，
  // 否则同一次接触会在连续几帧里反复加速，两只粘在一起抽搐
  const closing = (along(a, touch.axis) - along(b, touch.axis)) * touch.sign
  const kick = closing > 0 ? closing * touch.sign : 0
  /** 这一只承担多少：**都能动就各让一半，撞上石头的自己全担**（等于撞墙）。 */
  const part = (me: Pet, other: Pet): number => (stone(me) ? 0 : stone(other) ? 1 : 0.5)
  const moved = (p: Pet, other: Pet, dir: number): Pet => {
    if (stone(p)) return p
    const k = part(p, other)
    return wake(shove(nudge(p, touch, dir * k), touch, -dir * kick * k * (1 + REST)), closing)
  }
  return [moved(a, b, 1), moved(b, a, -1)]
}

/**
 * 把陷进去的那点推出来。`share` 是**带符号的份额**：正的往法线的反方向让
 *（法线由 `touch.sign` 定，从 a 指向 b）。
 *
 * **必须乘 `sign`**：不乘的话「b 在 a 左边」时两只会朝着彼此推，越推越进去。
 */
function nudge(p: Pet, touch: Contact, share: number): Pet {
  const by = share * touch.sign * touch.depth
  return touch.axis === "x" ? { ...p, x: p.x - by } : { ...p, y: p.y - by }
}

/** 沿法向加一份速度。 */
function shove(p: Pet, touch: Contact, dv: number): Pet {
  return touch.axis === "x" ? { ...p, vx: p.vx + dv } : { ...p, vy: p.vy + dv }
}

/**
 * 撞到在地上待着的那只：**把它掀起来**。
 *
 * 蹭一下（关速小）就只把它推开，不改状态——那时候它还站在地上，
 * 一脚踹飞的反应配不上一次擦肩。
 */
function wake(p: Pet, closing: number): Pet {
  if (p.mode !== "rest" && p.mode !== "walk") return p
  if (closing < HIT_MIN) return { ...p, mode: "walk" }
  return { ...p, vy: p.vy - HIT_UP, mode: "air" }
}

/**
 * 还有东西在动吗。**没有就停掉 rAF**——一个天天开着的窗口不该为三只静止的
 * 史莱姆每秒醒 60 次。
 *
 * **被你捏着的那只也算在动。** 上一版把 `held` 判成不忙，于是捏着一只不放的时候
 * 整个帧循环是停的，而 `bump` 只在帧循环里跑——**拿它去推另外几只不会发生任何事**。
 * 现在捏着就转：你可以拿手里这只当推土机，把窝里那几只一路犁开。
 * 松手那一刻它变成 `air` 或 `rest`，循环照常自己停。
 */
export function busy(pets: readonly Pet[]): boolean {
  return pets.some((p) => p.mode !== "rest")
}
