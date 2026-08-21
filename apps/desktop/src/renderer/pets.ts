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

/** 一只的形。`dsh-mark` 是 DSH 鲸鱼的原型轮廓。 */
export type PetShape = "slime" | "crab" | "dsh-mark"

/** 怎么回窝。**螃蟹走，其余蹦**——它们本来就不是一种走法。 */
export type Gait = "walk" | "hop"

export interface PetLook {
  shape: PetShape
  /** 配色的名字，落到 CSS 的 `.pet--<tone>`。**颜色不进 tokens.css**，见 pets.css。 */
  tone: "kimi" | "claude" | "grok" | "dsh" | "plain"
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
  { prefix: "dsh", look: { shape: "dsh-mark", tone: "dsh" } },
]

/** 这只怎么回窝。形定的：螃蟹横着蹭回去，其余一路弹回去。 */
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

/** 活动区的两条硬边：地面（左上角能到的最大 y）和右墙。 */
export interface Bounds {
  floor: number
  right: number
}

/**
 * 挨了一下：多快、朝哪条轴。**界面拿它演挤压**——从天上砸下来是压扁，
 * 横着挨一记是压瘦，两者用同一个形的话，撞击就没了方向。
 */
export interface Hit {
  speed: number
  axis: "x" | "y"
}

/** 砸地慢过这个不算挨了一下——轻轻放下不该抖。 */
const HIT_LAND = 260
/** 撞墙 / 被撞时速度变了这么多才算。低于这个是擦一下。 */
const HIT_PUSH = 200

/**
 * 这一帧挨了哪一下：砸到地、撞到墙、还是撞到同伴。没有就 undefined。
 *
 * 三样都靠**比较前后**认出来——物理那几个函数是纯的，它们不知道自己是第几帧：
 *
 * - 砸地：这一帧穿过了地面线，而且掉得够快；
 * - 撞墙：横速被 `contain` 翻了向，**而且人确实贴着墙**——只看翻向会把
 *   「落在窝的另一侧、掉头往回蹦」也算成撞墙；
 * - 撞同伴：`bump` 把速度改了（`stepped` 是撞之前、`now` 是撞之后）。
 */
export function hitOf(was: Pet, stepped: Pet, now: Pet, bounds: Bounds): Hit | undefined {
  if (was.y < bounds.floor && now.y >= bounds.floor && was.vy > HIT_LAND) {
    return { speed: was.vy, axis: "y" }
  }
  const wall = stepped.x <= 0.5 || stepped.x >= bounds.right - 0.5
  if (wall && Math.abs(was.vx) > HIT_PUSH && Math.sign(stepped.vx) === -Math.sign(was.vx)) {
    return { speed: Math.abs(was.vx), axis: "x" }
  }
  const dx = Math.abs(now.vx - stepped.vx)
  const dy = Math.abs(now.vy - stepped.vy)
  const most = Math.max(dx, dy)
  return most > HIT_PUSH ? { speed: most, axis: dx >= dy ? "x" : "y" } : undefined
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
