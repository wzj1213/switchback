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

/**
 * 一块碎屑。挨打崩三点、死掉炸十点、被胖子吃掉的字也化成几点。
 *
 * **它是「刚才那一下打中了」唯一的即时反馈**：血条要挨过打才出现，
 * 而崩出来的这几点是打中的那一帧就在的——没有它，低流速下一发一发地打，
 * 画面上和「没打中」分不出来。
 */
export interface Part {
  x: number
  y: number
  vx: number
  vy: number
  /** 活了多久 / 能活多久（秒）。 */
  t: number
  d: number
}

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
  /** 崩出来的碎屑。**跟着这一只走**，它散完之前这一只不从数组里消失。 */
  parts: Part[]
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
  swarm: { hp: 2, speed: 130, fly: 30, pack: 5 },
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
      parts: [],
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

/**
 * 中一发。**伤害恒为 1**：火力靠射速表达，不靠每发的大小。
 *
 * `at` 是弹着点，用来把碎屑崩在对的地方；不给就崩在身体中间——
 * 测试不关心这个，所以它可选。
 */
export function hitFoe(
  foe: Foe,
  at?: { x: number; y: number },
  rand: () => number = Math.random,
): void {
  if (foe.dying > 0) return
  foe.hp -= 1
  foe.flash = 0.11
  foe.knock += 5.5
  const spot = at ?? { x: foe.x, y: foe.y - 11 }
  for (let i = 0; i < 3; i++) {
    foe.parts.push(fleck(spot, { x: 40 + rand() * 90, y: -40 - rand() * 70 }, 0.42))
  }
  if (foe.hp > 0) return
  foe.dying = 0.0001
  // 死掉那一下炸开一圈。**比挨打那三点大得多**——「打掉了」和「打中了」
  // 是两件事，而这套东西里没有任何文字会去说哪件发生了
  for (let i = 0; i < 10; i++) {
    foe.parts.push(
      fleck(
        { x: foe.x + (rand() - 0.5) * 16, y: foe.y - 11 - rand() * 12 },
        { x: (rand() - 0.5) * 180, y: -70 - rand() * 120 },
        0.7,
      ),
    )
  }
}

const fleck = (at: { x: number; y: number }, v: { x: number; y: number }, d: number): Part => ({
  x: at.x,
  y: at.y,
  vx: v.x,
  vy: v.y,
  t: 0,
  d,
})

/** 碎屑的重力。比本体快——碎屑轻，落得却比整只快，那是它读起来像碎屑的原因。 */
const PART_G = 620

/**
 * 推进一帧，返回**这一帧有几只咬到了**。
 *
 * 咬到不掉等级、不影响任何数：它记的是「这一轮零输出被摸到脸上的次数」，
 * 是健康度，不是分数。
 */
export function stepFoes(foes: Foe[], dt: number, handX: number, eat?: FoeEater): number {
  let bites = 0
  for (let i = foes.length - 1; i >= 0; i--) {
    const f = foes[i]
    if (f === undefined) continue
    f.age += dt
    stepParts(f.parts, dt)
    if (f.dying > 0) {
      f.dying += dt
      // **碎屑没散完就先别删**：整只已经不见了、碎屑却跟着一起消失的话，
      // 死掉那一下就成了「啪一下没了」，看不出是被打掉的
      if (f.dying > FADE && f.parts.length === 0) foes.splice(i, 1)
      continue
    }
    f.flash = Math.max(0, f.flash - dt)
    f.knock *= Math.exp(-dt * 9)
    f.x += f.speed * dt
    if (f.kind === "swarm") f.fly = KINDS.swarm.fly * (0.7 + 0.5 * Math.sin(f.age * 4.3))
    if (f.kind === "glut" && eat !== undefined) gnaw(f, eat)
    if (f.x + f.knock > handX - BITE_AT) {
      f.dying = 0.0001
      bites++
    }
  }
  return bites
}

/**
 * 胖子吃字。
 *
 * **这是三种怪里最准的一条**：上下文满了，前面产出的东西真的会被压缩掉——
 * 所以它路过纸带时把字叼走，不是装饰，是那件事的字面画法。
 *
 * 回调而不是直接拿纸带：这个模块不认识纸带，认识了就得 import 子弹那一路，
 * 而两边本来毫无关系。
 */
export type FoeEater = (x: number, reach: number) => readonly { x: number; y: number }[]

/** 胖子的嘴有多宽。 */
const GNAW = 15

function gnaw(f: Foe, eat: FoeEater): void {
  for (const bit of eat(f.x + f.knock, GNAW)) {
    f.parts.push(fleck(bit, { x: 12 + Math.random() * 26, y: -24 - Math.random() * 26 }, 0.34))
  }
}

export function stepParts(parts: Part[], dt: number): void {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p === undefined) continue
    p.t += dt
    if (p.t > p.d) {
      parts.splice(i, 1)
      continue
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += PART_G * dt
  }
}
