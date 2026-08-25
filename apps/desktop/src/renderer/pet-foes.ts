import { clamp } from "./pet-gun.js"

/**
 * 从左边爬过来的那些。
 *
 * ## 它们不是关卡内容，是**压力的化身**
 *
 * 这是「打怪」这一层唯一站得住的设计约束：**每一种怪都对应一个真实的信号，
 * 打不打得掉由那个信号决定**。随机刷出来的敌人是装饰；而这些不是——
 * 你打不动它们的时候，恰恰就是引擎真的不顺的时候：
 *
 * - **史莱姆 ← 静默。** 这一轮在跑，但一个字都不出。走得慢、来得勤。
 * - **蜂群 ← 低流速。** 血薄但一来一簇。**低流速时最难清**——不是因为它们厚，
 *   是因为你的射速跟不上它们的只数，而那正是被限流时的体感。
 * - **胖子 ← 上下文逼近上限。** 血厚、走得极慢，**一路把纸带上的字吃掉**。
 *   三种里最准的一个：上下文满了，前面产出的东西真的会被压缩掉。
 *
 * 火力恒等于流速（`pet-shots.ts`），所以这里不需要任何「难度」旋钮：
 * 引擎吐得快就清得掉，吐不出来就清不掉。**这不是平衡，这是事实。**
 *
 * 纯逻辑：不读时钟、不碰 DOM，随机由调用方给。
 */

export type FoeKind = "slime" | "swarm" | "glut"

export interface Foe {
  kind: FoeKind
  x: number
  y: number
  /** 飞多高。只有蜂群离地。 */
  fly: number
  hp: number
  hp0: number
  /** 挨打时往后弹的偏移，会自己回零。 */
  knock: number
  /** 挨打的白闪还剩多久。 */
  flash: number
  /** 走多快（像素/秒）。每只略有不同，不然像一排复制粘贴。 */
  speed: number
  /** 活了多久。蜂群的上下浮动靠它。 */
  age: number
  /** 死了多久。>0 就是在消散，不再前进也不再挨打。 */
  dying: number
}

interface Kind {
  hp: number
  speed: number
  fly: number
  /** 一次来几只。 */
  pack: number
}

const KINDS: Readonly<Record<FoeKind, Kind>> = {
  slime: { hp: 10, speed: 78, fly: 0, pack: 1 },
  swarm: { hp: 2, speed: 130, fly: 26, pack: 5 },
  glut: { hp: 34, speed: 38, fly: 0, pack: 1 },
}

/** 最多同时几只。**不是难度，是别让画面糊掉**。 */
const MAX_ALIVE = 8
/** 消散动画多久。 */
const FADE = 0.55
/** 走到离手多近算咬到。 */
const BITE_AT = 24

/**
 * 此刻的压力（0~1）与它对应的怪。
 *
 * **`undefined` 表示这一刻没有压力**——那时候一只都不该来。
 * 早先的写法是「总有一种」，于是引擎明明跑得好好的，画面上还在刷怪，
 * 「敌人 = 压力」那句话当场作废。
 */
export function pressureOf(input: {
  /** 这一轮在不在跑。不跑的时候没有压力可言——它只是在等你说话。 */
  running: boolean
  /** 估出来的流速。 */
  rate: number
  /** 已经静默了多久（秒）。 */
  quiet: number
  /** 上下文用了多满（0~1）。引擎没报窗口时给 0。 */
  ratio: number
}): { kind: FoeKind; level: number } | undefined {
  if (input.ratio >= 0.78) return { kind: "glut", level: clamp((input.ratio - 0.78) / 0.2, 0.2, 1) }
  if (!input.running) return undefined
  if (input.quiet >= 3) return { kind: "slime", level: clamp((input.quiet - 3) / 12, 0.15, 1) }
  if (input.rate > 1 && input.rate < 40) return { kind: "swarm", level: clamp((40 - input.rate) / 39, 0.15, 1) }
  return undefined
}

/** 下一只隔多久来。压力越大越勤：从十二秒一只压到一秒多一只。 */
export function nextGap(level: number): number {
  return 12 - clamp(level, 0, 1) * 10.6
}

/**
 * 放一批。`at.from` 是画布左边界，`at.ground` 是地面高度。
 *
 * 到上限就少放几只而不是不放：**一只都不放的话，围攻那一刻反而最安静**。
 */
export function spawnFoes(
  foes: Foe[],
  kind: FoeKind,
  at: { from: number; ground: number },
  rand: () => number,
): void {
  const spec = KINDS[kind]
  for (let i = 0; i < spec.pack && foes.length < MAX_ALIVE; i++) {
    foes.push({
      kind,
      x: at.from - i * 26 - rand() * 40,
      y: at.ground,
      fly: spec.fly * (0.7 + rand() * 0.6),
      hp: spec.hp,
      hp0: spec.hp,
      knock: 0,
      flash: 0,
      speed: spec.speed * (0.8 + rand() * 0.42),
      age: rand() * 4,
      dying: 0,
    })
  }
}

/** 离手最近的那只活的（x 最大）。**瞄最近的**——远的那只还有时间。 */
export function nearest(foes: readonly Foe[]): Foe | undefined {
  let best: Foe | undefined
  for (const f of foes) {
    if (f.dying === 0 && (best === undefined || f.x + f.knock > best.x + best.knock)) best = f
  }
  return best
}

/** 中一发。**伤害恒为 1**：火力靠射速表达，不靠每发的大小。 */
export function hitFoe(foe: Foe): void {
  if (foe.dying > 0) return
  foe.hp -= 1
  foe.flash = 0.11
  foe.knock += 5.5
  if (foe.hp <= 0) foe.dying = 0.0001
}

/**
 * 推进一帧，返回**这一帧有几只咬到了**。
 *
 * 咬到不掉等级、不影响任何数：它记的是「这一轮零输出被摸到脸上的次数」，
 * 是健康度，不是分数。
 */
export function stepFoes(foes: Foe[], dt: number, handX: number): number {
  let bites = 0
  for (let i = foes.length - 1; i >= 0; i--) {
    const f = foes[i]
    if (f === undefined) continue
    f.age += dt
    if (f.dying > 0) {
      f.dying += dt
      if (f.dying > FADE) foes.splice(i, 1)
      continue
    }
    f.flash = Math.max(0, f.flash - dt)
    f.knock *= Math.exp(-dt * 9)
    f.x += f.speed * dt
    if (f.kind === "swarm") f.fly = KINDS.swarm.fly * (0.7 + 0.5 * Math.sin(f.age * 4.3))
    if (f.x + f.knock > handX - BITE_AT) {
      f.dying = 0.0001
      bites++
    }
  }
  return bites
}
