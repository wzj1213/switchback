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

/** 第 index 只的窝在哪。窝在右下角，从右往左排，顺序和引擎清单一致。 */
export function homeXOf(index: number, count: number, width: number): number {
  return width - EDGE - (count - index) * SLOT + (SLOT - SIZE) / 2
}

/** 一只的运动状态。坐标是**左上角**，相对活动区。 */
export interface Pet {
  x: number
  y: number
  vx: number
  vy: number
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

/**
 * 推进一帧。**纯函数**：给同样的输入永远给同样的输出，不碰 DOM、不读时钟。
 *
 * `dt` 由调用方给（秒）。切后台再切回来时浏览器会攒出一个巨大的 dt，
 * 调用方负责夹住它——不夹的话这一帧的位移能把它送出屏幕外好几屏。
 */
export function step(pet: Pet, dt: number, world: World): Pet {
  if (pet.mode === "rest" || pet.mode === "held") return pet
  const { stage, homeX, gait } = world
  const floor = stage.height - SIZE
  const right = stage.width - SIZE

  if (pet.mode === "walk") {
    const gap = homeX - pet.x
    const move = WALK * dt
    if (Math.abs(gap) <= move) return { x: homeX, y: floor, vx: 0, vy: 0, mode: "rest" }
    return { ...pet, x: pet.x + Math.sign(gap) * move, y: floor }
  }

  // air / hop
  let vx = pet.vx
  let vy = pet.vy + G * dt
  let x = pet.x + vx * dt
  let y = pet.y + vy * dt

  // 两面墙。**先夹再反弹**，顺序反过来会让它嵌在墙里抖
  if (x < 0) {
    x = 0
    vx = Math.abs(vx) * WALL
  } else if (x > right) {
    x = right
    vx = -Math.abs(vx) * WALL
  }
  // 顶：拖上去松手时可能带着向上的速度，别让它飞出活动区
  if (y < 0) {
    y = 0
    vy = Math.abs(vy) * WALL
  }

  if (y < floor) return { x, y, vx, vy, mode: pet.mode }

  // 落地
  y = floor
  // **只有被甩出去的才弹。** 它自己蹦的那一下落地就该停——一个自己起跳的东西
  // 落地还颠一下，看起来是摔的不是跳的
  if (pet.mode === "air" && vy >= SETTLE)
    return { x, y, vx: vx * SKID, vy: -vy * BOUNCE, mode: "air" }
  return arrive(x, y, homeX, gait)
}

/** 停稳在地面上的那一刻：到家就歇着，没到家就按自己的步态继续。 */
function arrive(x: number, y: number, homeX: number, gait: Gait): Pet {
  if (Math.abs(homeX - x) <= NEAR) return { x: homeX, y, vx: 0, vy: 0, mode: "rest" }
  if (gait === "walk") return { x, y, vx: 0, vy: 0, mode: "walk" }
  // 一跳的滞空时间是固定的，所以**最后一跳按剩下的距离算横速**，
  // 正好落在窝里——不然它会在窝口来回蹦过头
  const air = (2 * HOP_VY) / G
  const gap = homeX - x
  const vx = Math.abs(gap) / air < HOP_VX ? gap / air : Math.sign(gap) * HOP_VX
  return { x, y, vx, vy: -HOP_VY, mode: "hop" }
}

/** 还有东西在动吗。**没有就停掉 rAF**——一个天天开着的窗口不该为三只静止的史莱姆每秒醒 60 次。 */
export function busy(pets: readonly Pet[]): boolean {
  return pets.some((p) => p.mode !== "rest" && p.mode !== "held")
}
