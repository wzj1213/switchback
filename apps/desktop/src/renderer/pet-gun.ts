/**
 * 手里那把枪。**纯逻辑那一半**：它在哪、指向哪、抽出来了没有。
 *
 * ## 这一层唯一的硬约束：火力恒等于流速
 *
 * 射速只由 `item.delta` 估出来的流速决定（见 `throughput.ts`）。
 * 等级、皮肤、设置里的任何一项都**不改射速、不改伤害**——一旦它们能改，
 * 画面上打得掉打不掉说的就是你的存档，而不是引擎此刻的表现，
 * 而后者才是这套东西存在的全部理由。
 *
 * ## 为什么是弹簧不是缓动
 *
 * 缓动（`lerp` 到目标）没有惯性，枪会像贴图一样黏在手上。欠阻尼弹簧过冲的
 * 那一点点，就是「握在手里」和「焊在身上」的全部区别。代价是它有稳定条件：
 * 显式欧拉在 `h < 2/C` 之外指数发散，几百帧后溢出成 `Infinity`，
 * 再一步就是 `NaN`——所以 `dt` 必须由调用方夹住（见 `MAX_DT`）。
 *
 * 纯函数：不读时钟、不碰 DOM、不含随机（抖动由调用方给）。
 */

/** 一把枪此刻的样子。角度是弧度，**canvas 的 +y 朝下**。 */
export interface Gun {
  x: number
  y: number
  vx: number
  vy: number
  /** 指向。π 是水平朝左。 */
  ang: number
  angV: number
  /** 后坐带来的枪口上跳。**正数是抬起来**——见 `KICK` 那段。 */
  kick: number
  kickV: number
  /** 抽出来了多少：0 收着、1 端平。 */
  arm: number
  /** 已经安静了多久（秒）。到点才收枪，见 `GRACE`。 */
  silent: number
  /** 还没落到手上过。第一帧要直接就位，不然它会从画布左上角飞过来。 */
  placed: boolean
  /** 弹匣里还剩几发。 */
  mag: number
  /**
   * 换弹还剩多少秒。**大于 0 时一发都不出膛。**
   *
   * 加这一档不是为了拟真，是为了**让连发有个尽头**：上一版只要流速够高就
   * 一直突突，一串弹着连成一条线，既读不出节奏也读不出后坐——而那两样
   * 恰恰是这套东西要给的（见 `pet-range.ts`）。隔十来发停半秒，
   * 那一串就自然断成一簇一簇，每簇的起点又都是归零的枪口。
   */
  reload: number
}

export interface Hand {
  x: number
  y: number
}

export interface GunInput {
  hand: Hand
  /** 想指哪儿（弧度）。 */
  want: number
  /** 该不该端着。 */
  armed: boolean
  /**
   * **手里要换别的东西**（在跑工具、在等审批）。
   *
   * 和「暂时没输出」不是一回事：后者给宽限（`GRACE`），前者立刻收——
   * 否则切到跑工具的那一秒半里，枪和终端会同时在手上。
   */
  hard: boolean
}

export function createGun(): Gun {
  return {
    x: 0, y: 0, vx: 0, vy: 0, ang: Math.PI, angV: 0, kick: 0, kickV: 0,
    arm: 0, silent: 9, placed: false, mag: MAG, reload: 0,
  }
}

/**
 * `dt` 的上限（秒）。
 *
 * 四条弹簧里刚度最低的那条给出的稳定门槛约 0.078；切后台再切回来时浏览器会攒出
 * 一个巨大的 `dt`，不夹住的话**一帧就发散**。0.05 一刀切在全部门槛之下。
 */
export const MAX_DT = 0.05

/* 手感常数。都能随便调，测试钉的是行为不是这些数。 */
/** 位置弹簧的刚度与阻尼比。0.62 欠阻尼——过冲那一点点就是「握在手里」。 */
const K_POS = 430
const Z_POS = 0.62
/** 角度弹簧。比位置阻尼大一些：枪口来回摆比手抖更让人分心。 */
const K_ANG = 250
const Z_ANG = 0.72
/** 枪离手最远多少。弹簧再怎么过冲也不能让它飘出手掌。 */
const LEASH_X = 6
const LEASH_Y = 7
/** 抽枪比收枪快：抽要利落，收要不舍得。 */
const RATE_DRAW = 13
const RATE_STOW = 6.5
/** 安静多久才收枪。给「暂时没输出」留的宽限——不给的话它一秒收一次、一秒抽一次。 */
const GRACE = 1.5
/** 后坐的角度分量：回中刚度与阻尼。 */
/** 一匣多少发。十来发一簇：够看出后坐一路上抬，又不至于长到读不出簇。 */
export const MAG = 14
/**
 * 换一次弹要停掉「几发的工夫」。
 *
 * **不是一个固定的秒数，这一点是关键。** 这一层的宪法是「火力恒等于流速」——
 * 发数就是那一秒吐了多少字。而固定秒数的换弹会**按流速的高低吃掉不同比例**的发数：
 * 流速越高，同样半秒里丢掉的越多，于是「流速翻倍、发数翻倍」当场不成立
 *（实测：190 t/s 那条纸带用例直接空了）。
 *
 * 按「几发的工夫」算，占空比就和流速无关了：不管快慢都是同样的比例，
 * 发数照旧正比于流速，而画面上照旧一簇一簇。
 */
export const RELOAD_SHOTS = MAG * 0.22
/** 换弹时枪口垂下来的角度。π 是水平朝左，往 π/2 走就是朝下（canvas 的 +y 朝下）。 */
export const RELOAD_ANGLE = Math.PI * 0.78

const K_KICK = 190
const C_KICK = 13
/**
 * 枪口上跳的上下限。
 *
 * **上跳是角度变大**：canvas 里 +y 朝下，190° 指左上、170° 指左下。
 * 早先这里写的是减，于是每打一发枪口往下压一点，连发时一路指向地面。
 * 不封顶的话连发会把枪口一路抬到天上去。
 */
const KICK_MAX = 0.2
const KICK_MIN = -0.05

/**
 * 绕回 ±π 之内。**角度差必须先绕**：atan2 给 -179°、静止角是 +190°，
 * 不绕的话枪会从 0° 那边转一大圈过去。
 *
 * 两个端点都可能出现（±π 指的是同一个方向），这里不为了区间的漂亮再多判一次——
 * 调用方要的是「往哪边转、转多少」，而 +π 和 -π 转起来一样远。
 */
export function wrapAngle(d: number): number {
  let x = d
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

/**
 * 打一发带来的上跳，顺带扣子弹。`n` 是这一簇的发数——一簇压着一簇，但封顶。
 *
 * 打空了就**当场进换弹**：弹匣立刻装满，但 `reload` 那段时间里出不了膛。
 */
export function kickOf(gun: Gun, n: number): Gun {
  const kicked = { ...gun, kickV: gun.kickV + 3.4 + Math.min(n, 3) * 0.5 }
  const left = gun.mag - n
  return left > 0 ? { ...kicked, mag: left } : { ...kicked, mag: MAG }
}

/** 这一发打空了弹匣没有。打空了调用方要起一次换弹（见 `pet-fx.ts`）。 */
export function emptied(gun: Gun, n: number): boolean {
  return gun.mag - n <= 0
}

/** 此刻能不能出膛。换弹那半秒不能。 */
export function loaded(gun: Gun): boolean {
  return gun.reload <= 0
}

/**
 * 推进一帧。
 *
 * 调用方负责夹 `dt`（`MAX_DT`）——这里不夹是因为夹的动作属于「谁在驱动这个循环」，
 * 而同一个循环里还有别的东西要用同一个夹过的 `dt`。
 */
export function stepGun(gun: Gun, dt: number, input: GunInput): Gun {
  if (!gun.placed) {
    return { ...gun, x: input.hand.x, y: input.hand.y, ang: input.want, placed: true }
  }
  const silent = input.armed ? 0 : gun.silent + dt
  const want = input.armed ? 1 : input.hard || silent > GRACE ? 0 : 1
  const arm = approach(gun.arm, want, dt * (want > gun.arm ? RATE_DRAW : RATE_STOW))
  return {
    ...spring(gun, dt, input.hand),
    ...turn(gun, dt, input.want),
    ...recoil(gun, dt),
    arm: arm < 0.002 ? 0 : arm,
    silent,
    placed: true,
    // 收枪时把弹匣补满：下次抽出来是一把满的，而不是接着上次那半匣
    mag: arm < 0.002 ? MAG : gun.mag,
    reload: arm < 0.002 ? 0 : Math.max(0, gun.reload - dt),
  }
}

/** 位置：两条独立的弹簧，外加一条不许飘出手掌的缰绳。 */
function spring(gun: Gun, dt: number, hand: Hand): Pick<Gun, "x" | "y" | "vx" | "vy"> {
  const c = 2 * Z_POS * Math.sqrt(K_POS)
  const vx = gun.vx + ((hand.x - gun.x) * K_POS - gun.vx * c) * dt
  const vy = gun.vy + ((hand.y - gun.y) * K_POS - gun.vy * c) * dt
  return {
    vx,
    vy,
    x: clamp(gun.x + vx * dt, hand.x - LEASH_X, hand.x + LEASH_X),
    y: clamp(gun.y + vy * dt, hand.y - LEASH_Y, hand.y + LEASH_Y),
  }
}

function turn(gun: Gun, dt: number, want: number): Pick<Gun, "ang" | "angV"> {
  const c = 2 * Z_ANG * Math.sqrt(K_ANG)
  const angV = gun.angV + (wrapAngle(want - gun.ang) * K_ANG - gun.angV * c) * dt
  return { angV, ang: gun.ang + angV * dt }
}

function recoil(gun: Gun, dt: number): Pick<Gun, "kick" | "kickV"> {
  const kickV = gun.kickV + (-gun.kick * K_KICK - gun.kickV * C_KICK) * dt
  return { kickV, kick: clamp(gun.kick + kickV * dt, KICK_MIN, KICK_MAX) }
}

/** 指数逼近，一帧一步。`rate` 已经乘过 dt。 */
function approach(from: number, to: number, rate: number): number {
  return from + (to - from) * (1 - Math.exp(-rate))
}

/**
 * **NaN-safe**：`v < a ? a : …` 对 NaN 两边比较都为假、会把 NaN 原样放行。
 * 一旦有一路弹簧发散，NaN 会顺着枪口坐标传遍全场，而且再也回不来。
 */
export function clamp(v: number, a: number, b: number): number {
  if (!(v > a)) return a
  return v > b ? b : v
}
