import { clamp } from "./pet-gun.js"

/**
 * 打靶。
 *
 * ## 先说清楚它和其余每一样都不是一类东西
 *
 * 这套东西里每一样都编码着一个真实的引擎信号，而**打靶编码不了任何东西**——
 * 引擎不会没事去打靶。所以它不是产品状态，是个**评估台**：把三样平时只能
 * 靠感觉判断的东西摆到一个能量的地方。
 *
 * - **节奏** → 弹着在时间上的疏密。逐字吐的和成段吐的，打出来的洞不一样。
 * - **后坐** → 弹着在空间上的**上飘**。连发时枪口一路上抬，洞就一路往上串——
 *   这是那条 kick 曲线唯一能被直接看见的地方。
 * - **上下文** → **有效区**。靶上被上下文吃掉的那一圈不算命中。
 *
 * ## 唯一有资格影响命中率的是上下文
 *
 * 等级、皮肤、设置里的任何一项都不碰命中率——那条宪法在这儿同样成立。
 * 上下文能碰，是因为**上下文变满本来就是真实的能力衰减**，不是存档进度：
 * 53% 时有效半径还剩八成，90% 时只剩三成半，同样的火力打进去的越来越少。
 *
 * 纯逻辑：不读时钟、不碰 DOM，随机由调用方给。
 */

/** 靶立在手往左多远。 */
export const TG_D = 205
/** 靶纸半径。 */
export const TG_R = 13
/** 靶心比地面高多少。往下一点，好让靶杆和台账都留在台面里。 */
export const TG_UP = 27
/** 弹着最多留几个。到头丢最旧的——一张靶上一百多个洞已经读不出散布了。 */
const HOLES_MAX = 140

export interface Hole {
  /** 相对靶心。 */
  x: number
  y: number
  /** 进了有效区没有。 */
  in: boolean
}

export interface Target {
  holes: Hole[]
  hits: number
  shots: number
}

export function createTarget(): Target {
  return { holes: [], hits: 0, shots: 0 }
}

/**
 * 有效区半径。
 *
 * 上下文占满时剩 28%——**不归零**：归零的话「打不进去」和「靶没了」
 * 在画面上是同一件事，而前者是信息、后者是故障。
 */
export function effOf(ratio: number): number {
  return TG_R * (1 - clamp(ratio, 0, 1) * 0.72)
}

/**
 * 算这一发会落在靶上哪儿。**只算不记**——记在 `land`。
 *
 * 弹着 = 瞄准点 + **后坐上飘** + 一点随机。上飘那一项是连发的代价，
 * 所以爆发档那一串洞会往上串，而限流档是一小团。
 *
 * 随机用三个均匀数相加逼近正态：一个均匀数打出来的散布是个方块，
 * 而真实的散布是往中间聚的。
 */
export function punch(kick: number, ratio: number, rand: () => number): Hole {
  const ox = bell(rand) * 1.7
  const oy = -kick * 52 + bell(rand) * 1.7
  const x = clamp(ox, -TG_R + 1, TG_R - 1)
  const y = clamp(oy, -TG_R + 1, TG_R - 1)
  return { x, y, in: Math.hypot(x, y) <= effOf(ratio) }
}

/**
 * 记一个弹着。**在子弹落到靶上那一刻记，不在出膛那一刻**——
 * 出膛就记的话，洞会比子弹先出现，而这套东西里飞行时间本身就是要看的东西之一。
 */
export function land(target: Target, hole: Hole): void {
  target.holes.push(hole)
  if (target.holes.length > HOLES_MAX) target.holes.shift()
  target.shots += 1
  if (hole.in) target.hits += 1
}

function bell(rand: () => number): number {
  return (rand() + rand() + rand() - 1.5) * 2
}

/** 散布（像素）。少于四个洞时说不出散布——**那时候写「—」比写一个数诚实**。 */
export function spreadOf(target: Target): number | undefined {
  const n = target.holes.length
  if (n <= 3) return undefined
  let mx = 0
  let my = 0
  for (const hole of target.holes) {
    mx += hole.x
    my += hole.y
  }
  mx /= n
  my /= n
  let sum = 0
  for (const hole of target.holes) sum += (hole.x - mx) ** 2 + (hole.y - my) ** 2
  return Math.sqrt(sum / n)
}

/** 清靶。换会话、换轮次时调——上一轮的弹着不属于这一轮。 */
export function clearTarget(target: Target): void {
  target.holes.length = 0
  target.hits = 0
  target.shots = 0
}
