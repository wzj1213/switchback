import { createBrass, type Brass, type BrassMode } from "./pet-brass.js"
import type { TrajMode } from "../shared/settings.js"
import { createGun, type Gun } from "./pet-gun.js"
import type { Bullet, Glyph } from "./pet-shots.js"
import type { Foe } from "./pet-foes.js"
import type { Bench } from "./bench.js"
import type { Field, Stand } from "./pet-fx-geo.js"
import { createShow, createTarget, type Hole, type Show, type Target } from "./pet-range.js"
import type { Pet, PetShape } from "./pets.js"

/**
 * 开火那一层的**世界长什么样**、一开始是什么样。
 *
 * 和推进器（`pet-fx.ts`）分开是行数闸门逼的，但边界也顺：那边一帧一帧地改它，
 * 这边只回答「它由哪些东西组成」。想加一样新东西（弹壳、靶都是这么加进来的），
 * 先在这儿开一格，再去那边写它怎么动——**顺序反过来的话，那样东西会先以
 * 一个局部变量的身份活几帧，然后在某次跳帧之后消失**。
 */

/** 一发子弹外加「它打的是谁」。**目标的身份只存在于这一层**——见 `stepShots`。 */
export interface Shot extends Bullet {
  foe?: Foe
  /** 打靶那一档：这一发会落在靶上哪个点。**落到的那一刻才记账**。 */
  hole?: Hole
}

export interface FxWorld {
  gun: Gun
  bullets: Shot[]
  tape: Glyph[]
  /** 从左边爬过来的那些。 */
  foes: Foe[]
  /** 弹壳。见 `pet-brass.ts`。 */
  brass: Brass
  /** 靶。**只有打靶那一档用得上**，其余时候它是空的。 */
  target: Target
  /** 靶场此刻画多浓。见 `pet-range.ts` 里「靶场什么时候显形」。 */
  show: Show
  /** 这一层自己的钟（秒）。刷怪的节拍按它走，**不读时钟**。 */
  clock: number
  /** 下一只该在什么时候来。 */
  nextAt: number
  /** 已经安静了多久（秒）。静默那条压力按它算。 */
  quiet: number
  /** 这一轮被摸到脸上几次。**只记账，不影响任何数**——它是健康度不是分数。 */
  bites: number
  /** 欠着的发数。见 `fireStep`。 */
  acc: number
  /** 下一个要落的字。**顺着来而不是随机**：随机会落出一串看不出是文字的乱码。 */
  ch: number
  /** 上一帧这一轮在不在跑。**结账那一下靠它认**——弹壳堆要在那时被扫平。 */
  ran: boolean
  /** 上一帧动没动过。用来判断「忙→闲」那一帧要不要再画一次收尾。 */
  moving: boolean
  /**
   * 上一帧的取景。**画的那一层只认这个**。
   *
   * 不让 `drawFx` 也收一份 `FxInput`：那样同一份输入要在两处各解释一遍，
   * 而两处解释迟早会分岔（第一次就是靶心的高度——推进按手算、绘制按脚线算，
   * 于是子弹落在靶的上方两像素处，看起来永远脱靶）。
   */
  view: View
}

export interface View {
  handX: number
  handY: number
  /**
   * 那只的脚线。画的那一层拿它定「这只站在哪儿」。
   *
   * **弹壳不落在这条线上**（一度是）：拎着它一边拖一边打时，这条线在半空，
   * 于是每一枚壳都停在甩出去那一刻手的高度——整屏悬着壳。壳落 `Stand.ground`
   * 那条台面线，见 `pet-fx.ts` 的 `fireOut`。
   */
  ground: number
  /**
   * 靶立在哪儿。**和 `ground` 是两条线，不能合**：弹壳跟着人走，靶不跟。
   * 上一版只有一条线，于是把桌宠拖到半空时靶也悬空了。
   */
  stand: Stand
  rate: number
  ratio: number
  /** 上一轮的成绩。**靶上那行读数用它**，见 `pet-range-draw.ts`。 */
  bench: Bench | undefined
}

export function createFx(): FxWorld {
  return {
    gun: createGun(),
    bullets: [],
    tape: [],
    foes: [],
    brass: createBrass(),
    target: createTarget(),
    show: createShow(),
    clock: 0,
    nextAt: 3,
    quiet: 0,
    bites: 0,
    acc: 0,
    ch: 0,
    ran: false,
    moving: true,
    view: {
      handX: 0,
      handY: 0,
      ground: 0,
      stand: { x: 0, ground: 0 },
      rate: 0,
      ratio: 0,
      bench: undefined,
    },
  }
}

export interface FxInput {
  /** 当前那只此刻在哪。**枪、弹壳、纸带、怪，全都挂在这一个点上。** */
  pet: Pet
  /** 当前那只的轮廓。枪的挂点要接到它真实的手/横臂上。 */
  shape: PetShape
  /** 估出来的流速（token/秒）。见 `throughput.ts`。 */
  rate: number
  /**
   * 手里要不要换别的东西：在跑工具、在等审批。
   * 这时立刻收枪——枪和终端不能同时在手上。
   */
  busyHands: boolean
  /** 这一轮在不在跑。不跑的时候没有压力可言——它只是在等你说话。 */
  running: boolean
  /** 上下文用了多满（0~1）。引擎没报窗口时给 0。 */
  ratio: number
  /**
   * 上一轮的成绩（TTFT 与业界口径的 t/s）。**只有靶那一档读它**——
   * 它不参与任何物理，纯粹是要印到画面上的一行字。见 `bench.ts`。
   */
  bench: Bench | undefined
  /** 画布左边界：怪从那儿爬进来。 */
  left: number
  /**
   * 台面：窝在哪、地面线在哪。**靶钉在这上面，不钉在那只身上**——
   * 这是本层不走 `pet` 坐标的输入（见 `pet-fx-geo.ts`）。
   */
  field: Field
  /** 让不让压力显形。关掉之后只剩打纸带那一层。 */
  foes: boolean
  /** 弹壳归谁。见 `pet-brass.ts`。 */
  brass: BrassMode
  /** 弹丸打到哪儿去。见 `PetKit.traj`。 */
  traj: TrajMode
  /** 打靶。开着时纸带那一路让位——同一把枪不能同时打两个地方。 */
  range: boolean
  /** 随机源。**由调用方给**，所以这一层可以被确定性地测。 */
  rand: () => number
}

/**
 * 换会话：把这一层整个清回出厂状态。
 *
 * ## 为什么必须清，而且必须清干净
 *
 * `useFlow` 早就在换会话时清滑窗了（「上一条的流速不属于这一条」），
 * 而这一层一直没跟上——于是切过去的那一刻，**上一条会话的怪还在往你脸上爬、
 * 上一条的纸带还挂在那儿、上一条的弹壳还堆在地上**，靶上更是攒着别人的命中率。
 * 每一样都在画一件没在这条会话里发生的事，那比不画糟得多。
 *
 * **原地清而不是换一个新世界**：这一层的持有者是一个 effect 里的局部变量，
 * 换引用的话正在跑的那一帧还攥着旧的那个，清了个寂寞。
 */
export function resetFx(w: FxWorld): void {
  const fresh = createFx()
  w.gun = fresh.gun
  w.bullets.length = 0
  w.tape.length = 0
  w.foes.length = 0
  w.brass.flying.length = 0
  w.brass.pile.length = 0
  w.target.holes.length = 0
  w.target.hits = 0
  w.target.shots = 0
  w.clock = fresh.clock
  w.nextAt = fresh.nextAt
  w.quiet = fresh.quiet
  w.bites = fresh.bites
  w.acc = fresh.acc
  w.ch = fresh.ch
  w.ran = fresh.ran
  w.moving = true
}
