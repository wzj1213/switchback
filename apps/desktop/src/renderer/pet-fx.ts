import { createGun, kickOf, MAX_DT, stepGun, wrapAngle, type Gun } from "./pet-gun.js"
import { fireStep, GLYPH_W, rpsOf, spawn, stepShots, stepTape, type Bullet, type Glyph } from "./pet-shots.js"
import { SIZE, type Pet } from "./pets.js"

/**
 * 开火那一层的世界。**把三个纯模块（枪、子弹、纸带）串成一帧。**
 *
 * ## 这一层为什么和桌宠本体是分开的
 *
 * 桌宠本体（`pets.ts` / `usePets.ts` / `petPaint.ts`）回答的是「它在哪、
 * 你把它扔到哪儿去了」——那是 DOM 上的三层 transform，和这里没有关系。
 * 这一层回答的是「引擎此刻吐得多快」，画在**一张 canvas** 上。
 *
 * 两层之间只有一个接口：**`Pet` 的坐标**。fx 每帧读一次当前那只的位置算出手在哪，
 * 除此之外不碰对方任何东西——不读 DOM、不发事件、不共享可变状态。
 * 所以关掉 fx 时桌宠一切照旧，反过来也一样。
 *
 * ## 一帧只推进一次，画不画是另一件事
 *
 * `stepFx` 只改状态，`drawFx`（另一个文件）只读状态。分开是因为**空闲时要跳过绘制**
 * 而不能跳过推进——跳过推进的话，那些本该在这几帧里飞完的子弹会一直挂着，
 * 于是「不动了」这一刻永远不到，跳帧优化反而永远等不到机会。
 */

/** 纸带离手多远、离地多高。 */
const TAPE_DX = 108
const TAPE_DY = 12
/** 纸带最左能漂到哪儿（相对手）。到头就没了。 */
const TAPE_LEN = 190
/**
 * 静默时纸带漂多快。**开火时的漂速不是常数**——它等于「每秒几发 × 一个字宽」，
 * 于是落下来的永远是一条排得开的字（见 `GLYPH_W`）。
 * 静默时给一个固定的快速度：一条不动的字带会一直挂在那儿，
 * 而「空闲整帧不重绘」那条优化就永远等不到「不动」这一刻。
 */
const DRIFT_QUIET = 90
/**
 * 手在身子的哪个位置（占盒子的比例，不是绝对值——螃蟹和鲸的盒子不一样大）。
 *
 * **横向是负的：手在身子左沿外面一点点。** 画布压在桌宠底下，
 * 手心搁在身体内侧的话整把枪都被身子盖住，只剩枪口焰像个悬空的火星
 *（实测就是这样）。挪出去之后，枪托那一小截还压在身下——那正好读作「握着」。
 */
const HAND_X = -0.04
const HAND_Y = 0.72
/** 枪管从手心往外探多远。出膛点＝手 + 这一段，按枪的指向旋过去。 */
const BARREL = 11

export interface FxWorld {
  gun: Gun
  bullets: Bullet[]
  tape: Glyph[]
  /** 欠着的发数。见 `fireStep`。 */
  acc: number
  /** 下一个要落的字。**顺着来而不是随机**：随机会落出一串看不出是文字的乱码。 */
  ch: number
  /** 上一帧动没动过。用来判断「忙→闲」那一帧要不要再画一次收尾。 */
  moving: boolean
}

export function createFx(): FxWorld {
  return { gun: createGun(), bullets: [], tape: [], acc: 0, ch: 0, moving: true }
}

export interface FxInput {
  /** 当前那只此刻在哪。**这是本层和桌宠本体之间唯一的接口。** */
  pet: Pet
  /** 估出来的流速（token/秒）。见 `throughput.ts`。 */
  rate: number
  /**
   * 手里要不要换别的东西：在跑工具、在等审批。
   * 这时立刻收枪——枪和终端不能同时在手上。
   */
  busyHands: boolean
  /** 随机源。**由调用方给**，所以这一层可以被确定性地测。 */
  rand: () => number
}

/** 手心在哪（相对活动区）。桌宠本体的坐标是左上角。 */
export function handOf(pet: Pet): { x: number; y: number } {
  return { x: pet.x + SIZE * HAND_X, y: pet.y + SIZE * HAND_Y }
}

/** 枪口在哪。出膛点必须在这儿算——算在别处的话第一帧子弹会从画布左上角飞出来。 */
export function muzzleOf(gun: Gun): { x: number; y: number } {
  const a = gun.ang + gun.kick
  return { x: gun.x + Math.cos(a) * BARREL, y: gun.y + Math.sin(a) * BARREL }
}

/** 纸带的落点与左边界。 */
export function tapeAt(hand: { x: number; y: number }): { x: number; y: number; left: number } {
  return { x: hand.x - TAPE_DX, y: hand.y - TAPE_DY, left: hand.x - TAPE_DX - TAPE_LEN }
}

/**
 * 推进一帧。`dt` 秒，**调用方不必夹**——这里夹（`MAX_DT`），
 * 因为夹的理由（弹簧的稳定门槛）属于这一层。
 */
export function stepFx(w: FxWorld, rawDt: number, input: FxInput): FxWorld {
  const dt = Math.min(rawDt > 0 ? rawDt : 1 / 60, MAX_DT)
  const hand = handOf(input.pet)
  const target = tapeAt(hand)
  const firing = input.rate > 1 && !input.busyHands
  const want = firing ? wrapAngle(Math.atan2(target.y - w.gun.y, target.x - w.gun.x)) : Math.PI * 1.02
  let gun = stepGun(w.gun, dt, { hand, want, armed: firing, hard: input.busyHands })

  // 抽枪没抽利落之前不开火：**于是「先抽枪、再开打」自然成了一个节拍**
  const ready = firing && gun.arm > 0.55
  const step = fireStep(w.acc, ready ? input.rate : 0, dt)
  let ch = w.ch
  if (step.shots > 0) {
    const from = muzzleOf(gun)
    for (let s = 0; s < step.shots; s++) {
      w.bullets.push(spawn(from, target, ch++, [input.rand() - 0.5, input.rand() - 0.5]))
    }
    gun = kickOf(gun, step.shots)
  }

  stepShots(w.bullets, w.tape, dt)
  const rps = rpsOf(ready ? input.rate : 0)
  stepTape(w.tape, dt, rps > 0 ? rps * GLYPH_W : DRIFT_QUIET, target.left)
  return { ...w, gun, acc: step.acc, ch, moving: busyOf(w, gun) }
}

/**
 * 这一帧之后还有没有东西在动。
 *
 * **判据必须囊括每一样会自己变的东西**：漏掉一样，那样东西就会在跳帧之后
 * 冻在半路上（而且不报错——canvas 保留着上一帧，看起来只是「卡了一下」）。
 */
function busyOf(w: FxWorld, gun: Gun): boolean {
  return w.bullets.length > 0 || w.tape.length > 0 || gun.arm > 0 || Math.abs(gun.kick) > 0.002
}
