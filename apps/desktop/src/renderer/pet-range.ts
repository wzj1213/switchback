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
 * ## 靶是钉死的，这是它能当台子用的全部前提
 *
 * 上一版的靶心每帧从**桌宠此刻的手**现算，于是那只蹦一下、你拖它一把，
 * 整张靶连同上面攒着的弹着一起飞。那样量出来的永远是「枪相对它自己」——
 * 距离恒等于 `TG_D`、角度恒等于水平，**桌宠动了多少一点都不进账**，
 * 而那恰恰是打靶唯一能测出来、别处测不出来的东西。顺带靶杆立在那只的脚下，
 * 把它拖到半空，靶就跟着悬空了。
 *
 * 现在靶钉在**台面**上（窝往左 `TG_D`、立在地面线），和那只此刻在哪无关。
 * 于是距离和角度成了变量：**同样的火力，站得远打出来的一定更散**——
 * 这就是 `punch` 收 `dist` 的原因。窝里那一档基本就是上一版
 *（`dist === TG_D` 时缩放因子正好是 1；实跑时 `dist` 量的是**枪口**到靶心，
 * 而 `TG_D` 量的是手到靶心，枪管探出去那一截让它比 1 小百分之几），
 * 拖出去才真的开始变。
 *
 * ## 唯一有资格影响命中率的是上下文和距离
 *
 * 等级、皮肤、设置里的任何一项都不碰命中率——那条宪法在这儿同样成立。
 * 上下文能碰，是因为**上下文变满本来就是真实的能力衰减**，不是存档进度：
 * 53% 时有效半径还剩八成，90% 时只剩三成半，同样的火力打进去的越来越少。
 * 距离能碰，是因为它是**你自己刚拖出来的**：站得远打不准不需要解释。
 *
 * 纯逻辑：不读时钟、不碰 DOM，随机由调用方给。
 */

/**
 * 靶钉在窝往左多远（**手**到靶心）。**这是「标称距离」，不是实际距离**：
 * 靶钉死之后，只有桌宠站在窝里时才大致是这么远，被你拖走就不是了。
 * `punch` 拿它当分母，于是「站在窝里」是散布的基准刻度。
 */
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

/** 这一发是从哪个条件下打出去的。 */
export interface Aim {
  /** 枪此刻的后坐量（弧度）。 */
  kick: number
  /** 上下文占了多满（0~1）。 */
  ratio: number
  /** 枪口到靶心的实际距离（像素）。**靶钉死之后这是个变量**，见文件头。 */
  dist: number
}

/**
 * 算这一发会落在靶上哪儿。**只算不记**——记在 `land`。
 *
 * 弹着 = 瞄准点 + **后坐上飘** + 一点随机，**两项都按距离放大**。
 * 按距离放大不是手感调料，是这台子唯一的物理：枪口偏了一个角，
 * 落到靶上的偏移就是这个角乘以飞过去的距离。所以站得远打出来一定更散，
 * 而**站在窝里（`dist === TG_D`）时和上一版一个数都不差**。
 *
 * 上飘那一项是连发的代价，所以爆发档那一串洞会往上串，而限流档是一小团。
 *
 * 随机用三个均匀数相加逼近正态：一个均匀数打出来的散布是个方块，
 * 而真实的散布是往中间聚的。
 */
export function punch(aim: Aim, rand: () => number): Hole {
  // 夹住下限：桌宠被拖到贴着靶时距离趋近 0，不夹的话所有洞会叠在正中央，
  // 于是「贴脸打」成了命中率最高的姿势——那是个 bug 不是技巧
  const far = Math.max(0.35, aim.dist / TG_D)
  const ox = bell(rand) * 1.7 * far
  const oy = -aim.kick * 52 * far + bell(rand) * 1.7 * far
  const x = clamp(ox, -TG_R + 1, TG_R - 1)
  const y = clamp(oy, -TG_R + 1, TG_R - 1)
  return { x, y, in: Math.hypot(x, y) <= effOf(aim.ratio) }
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
