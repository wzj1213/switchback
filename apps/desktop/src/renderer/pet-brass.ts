/**
 * 弹壳。
 *
 * ## 它凭什么可以调，而「密度」「难度」不可以
 *
 * 判据只有一条：**它改不改「打不打得掉」。** 弹壳不参与任何判定，
 * 它只是同一件事的另一种读法，所以三档都诚实（见 `PetKit.brass`）：
 *
 * - **抛出去**读的是**节奏**：一发一枚往斜后上方甩，连发时壳连成一串，
 *   一顿一顿时壳也一颗一颗地来。
 * - **堆着**读的是**在途**：壳不消失，落地就停，堆多高就是这一轮吐了多少。
 *   `Usage` 是一道阶梯、中间那几分钟是空的，而真正连接两级的量就叫在途——
 *   这是整套东西里唯一一处把它画出来的地方。结账那一下整堆扫平。
 *
 * 纯逻辑：不读时钟、不碰 DOM，随机由调用方给。
 */

export interface Case {
  x: number
  y: number
  vx: number
  vy: number
  /** 姿态角与角速度。翻着落地才像个壳，不像颗豆子。 */
  r: number
  vr: number
  /** 活了多久（秒）。抛出去那一档到点就没；堆着那一档只有被扫时才用。 */
  t: number
  /** 落到哪条线上。**每枚略有不同**，不然一排壳会像用尺子画的。 */
  gy: number
  /**
   * 这一枚自己的重力。
   *
   * **不是全场一个常数**：侧面甩出来的那些是「刚才开了一发」的余数，掉得越快越像屑；
   * 而抛壳那一档里这枚壳**就是那一发**，它得飘得起来——整条弧看得清，
   * 才读得出这一下有多大劲。两者差着一倍多。
   */
  g: number
  /** 飞多久就没（秒）。堆着那一路不看这个，它们靠 `rest` / `swept`。 */
  life: number
  /** 堆着那一档：已经停稳了。停稳的不再算物理。 */
  rest?: boolean
  /** 正在被扫走。 */
  swept?: boolean
}

export interface Brass {
  /** 抛出去那一路：飞一下就没。 */
  flying: Case[]
  /** 堆着那一路：落地就停，结账才扫。 */
  pile: Case[]
}

export function createBrass(): Brass {
  return { flying: [], pile: [] }
}

/** 抛出去那一路最多留几枚。到头丢最旧的。 */
const FLY_MAX = 26
/** 堆着那一路的上限。**它同时是「在途」的刻度上限**：堆满了就是很满。 */
const PILE_MAX = 70
/** 侧面那一枚飞多久就没了（秒）。 */
const FLY_MS = 1
/**
 * 主角那一枚飞多久（秒）、多大的重力。
 *
 * 照原型：`dur=1.05`、`GRV=210`（它的位移式是 `GRV*t*t`，等效重力 420）。
 * 比侧面那一枚飘得多——**因为它是「那一发」**，整条弧都得看得清。
 */
const HEAVE_MS = 1.05
const HEAVE_G = 420
/** 被扫走那一下飞多久。 */
const SWEEP_MS = 0.75
/** 侧面那一枚的重力。比子弹重得多——它该「掉」下去，不是飘。 */
const G = 560

export type BrassMode = "off" | "eject" | "pile"

export interface EjectAt {
  /** 抛壳口在世界坐标。 */
  x: number
  y: number
  /** 枪的指向（弧度）。壳往枪的反方向斜后上方甩。 */
  angle: number
  /** 地面在哪。 */
  ground: number
}

/** 抛一枚。`off` 档什么都不做。 */
export function eject(
  brass: Brass,
  mode: BrassMode,
  at: EjectAt,
  rand: () => number,
): void {
  if (mode === "off") return
  const cos = Math.cos(at.angle)
  put(brass, mode === "pile", {
    x: at.x,
    y: at.y,
    vx: -cos * 70 + (rand() - 0.5) * 30,
    vy: -72 - rand() * 42,
    r: rand() * 6,
    vr: 9 + rand() * 10,
    t: 0,
    gy: at.ground - 1 - rand() * 3.2,
    g: G,
    life: FLY_MS,
  })
}

/**
 * 把这一发**当成一枚壳**抛出去。
 *
 * ## 它和上面那个的区别只有一句：这一枚就是那一发
 *
 * 「抛壳」那一档下没有子弹、没有纸带——你看见的只有一枚壳往斜后上方飞出去、
 * 落地弹两下。**信号是后坐力**：这一下有多大劲、下一下隔多久来，
 * 全在那条弧和它们之间的间隔里。所以这一枚要飘得起来（`HEAVE_G`），
 * 也要活得久一点（`HEAVE_MS`），否则它和侧面那些屑就分不出来了。
 *
 * `pile` 只决定**落地之后留不留**。`off` 在这一档下不该把它吞掉——
 * 吞掉就等于这一发什么都没发生，而它确实发生了（界面上那一项也因此变灰）。
 */
export function heave(
  brass: Brass,
  pile: boolean,
  at: EjectAt,
  rand: () => number,
): void {
  const cos = Math.cos(at.angle)
  put(brass, pile, {
    x: at.x,
    y: at.y,
    vx: -cos * (45 + rand() * 62),
    vy: -(72 + rand() * 56),
    r: rand() * 6,
    vr: 6 + rand() * 9,
    t: 0,
    gy: at.ground - 1 - rand() * 3.2,
    g: HEAVE_G,
    life: HEAVE_MS,
  })
}

function put(brass: Brass, pile: boolean, one: Case): void {
  const into = pile ? brass.pile : brass.flying
  const cap = pile ? PILE_MAX : FLY_MAX
  into.push(one)
  if (into.length > cap) into.shift()
}

/** 推进一帧。 */
export function stepBrass(brass: Brass, dt: number): void {
  for (let i = brass.flying.length - 1; i >= 0; i--) {
    const c = brass.flying[i]
    if (c === undefined) continue
    c.t += dt
    if (c.t > c.life) {
      brass.flying.splice(i, 1)
      continue
    }
    bounce(c, dt, 0.34, 0.62)
  }
  for (let i = brass.pile.length - 1; i >= 0; i--) {
    const c = brass.pile[i]
    if (c === undefined) continue
    if (c.swept === true) {
      c.t += dt
      if (c.t > SWEEP_MS) brass.pile.splice(i, 1)
      else fly(c, dt, 520)
      continue
    }
    if (c.rest === true) continue
    bounce(c, dt, 0.3, 0.55)
    // 弹到几乎不动了就钉住。**不钉的话它会以亚像素的幅度永远抖**——
    // 而「还有东西在动」为真，空闲跳帧那条优化就永远等不到机会
    if (c.y >= c.gy && Math.abs(c.vy) < 26) {
      c.vy = 0
      c.vx = 0
      c.vr = 0
      c.y = c.gy
      c.rest = true
    }
  }
}

function fly(c: Case, dt: number, g: number): void {
  c.x += c.vx * dt
  c.y += c.vy * dt
  c.vy += g * dt
  c.r += c.vr * dt
}

function bounce(c: Case, dt: number, keepY: number, keepX: number): void {
  fly(c, dt, c.g)
  if (c.y <= c.gy) return
  c.y = c.gy
  c.vy *= -keepY
  c.vx *= keepX
  c.vr *= 0.5
}

/**
 * 结账：整堆扫走。
 *
 * **账在世界里结，不往 UI 上打。** 从桌宠那条 46px 的台面上射一颗子弹去撞
 * 顶栏一枚 12px 的图标，两边的幻觉是一起破的：世界漏到正文上、UI 挨了一梭子。
 */
export function sweep(brass: Brass, rand: () => number): void {
  for (const c of brass.pile) {
    c.swept = true
    c.rest = false
    c.t = 0
    c.vx = -(50 + rand() * 105)
    c.vy = -(20 + rand() * 72)
    c.vr = (rand() - 0.5) * 15
  }
}

/** 还有东西在动吗。**停稳的那些不算**——它们只是躺在地上。 */
export function brassMoving(brass: Brass): boolean {
  if (brass.flying.length > 0) return true
  return brass.pile.some((c) => c.rest !== true)
}
