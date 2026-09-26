import { clamp } from "./pet-gun.js"

/**
 * 子弹与纸带。**「火力恒等于流速」这句话的兑现处就在这个文件里。**
 *
 * ## 射速怎么定
 *
 * 每秒发数 = 流速 ÷ `TOKENS_PER_SHOT`，封在 `MAX_RPS`。
 * 除法是必须的：一发一 token 的话，190 t/s 会变成一面弹幕墙，
 * 而墙上看不出快慢。八个 token 一发之后，190 t/s ≈ 每秒二十四发——
 * 快得像连发，但每一发仍然在纸带上留下一个能看清的字。
 *
 * **封顶不是为了省力，是因为再快就读不出快慢了**；而封顶之上那一段，
 * 由纸带的漂移速度接着表达（漂速 = 每秒发数 × 一个字宽，见 `GLYPH_W`）。
 *
 * ## 打到哪儿去
 *
 * 打在一条**纸带**上，每中一发落一个字。纸带向左漂走、到头消失。
 * 这是整套里唯一一处「产出被留下来了」的说法：子弹不是打给敌人的，
 * 是打出字来的——**敌人只是路过时会挨到**。
 *
 * 纯逻辑：不读时钟、不碰 DOM。随机由调用方给（`jitter`），所以测试可控。
 */

/** 多少 token 换一发。见文件头。 */
const TOKENS_PER_SHOT = 8
/** 每秒最多几发。再多人眼读不出快慢，只剩一片糊。 */
const MAX_RPS = 30
/**
 * 一个字在纸带上占多宽（像素）。
 *
 * **纸带的漂移速度由它定**：每落一个字，纸带正好走过一个字宽——
 * 于是不管快慢，落下来的都是一条读得出是文字的线。
 * 早先漂移是个固定值，低速时字排得开、高速时全堆在同一个点上糊成一团。
 */
export const GLYPH_W = 10
/**
 * 一帧最多补几发。
 *
 * 累加器欠着的量在极端 dt 下可能很大（切后台再切回来），一次全放出来会在一帧里
 * 造出几十颗子弹。**这不是节流，是防炸**：真欠下的那些本来也没人看见。
 */
const MAX_PER_FRAME = 6

export interface Bullet {
  /** 出膛点。 */
  x0: number
  y0: number
  /** 落点。 */
  x1: number
  y1: number
  /** 飞了多久 / 要飞多久（秒）。 */
  t: number
  dur: number
  /** 这一发落下的是哪个字：模型刚写出来的那一个（`tape-text.ts`）。打怪、打靶的那几发是空串。 */
  ch: string
}

/** 纸带上已经落下的一个字。 */
export interface Glyph {
  x: number
  y: number
  ch: string
  /** 落下多久了（秒）。刚落下的那一下会弹一下。 */
  t: number
  /** 收工之后淡出到哪儿了（0~1）。到 1 就摘掉。 */
  gone: number
}

/**
 * 收工之后纸带多久淡干净（秒）。
 *
 * 上一版收工之后字照旧按静默速度慢慢往左漂，一条带子要漂好几秒才走完，
 * 这一轮都结束了，输入框上面还挂着几个零散的字（「>」「(」）。
 */
const TAPE_CLEAR = 0.9

/** 纸带最多留几个字。到头就从最旧的开始丢。 */
export const TAPE_MAX = 72

/**
 * 这一帧该打几发。
 *
 * `acc` 是欠着的发数，**必须由调用方存着**——每帧重算的话，
 * 低流速下每帧欠的都不足一发，于是永远打不出来。
 */
export function fireStep(acc: number, rate: number, dt: number): { acc: number; shots: number } {
  const next = acc + rpsOf(rate) * dt
  // **夹在 0 以上**：换弹会把 `acc` 推成负的（见 `pet-fx.ts` 的 `reload`），
  // 而负的发数会让下面那句把欠账一笔勾销——于是换弹变成了「白送几发」
  const shots = Math.max(0, Math.min(Math.floor(next), MAX_PER_FRAME))
  return { acc: next - shots, shots }
}

/**
 * 这个流速对应每秒几发。**纸带的漂移速度也由它定**（见 `GLYPH_W`），
 * 所以它得是个能单独拿出来问的数，不能藏在 `fireStep` 里。
 */
export function rpsOf(rate: number): number {
  return clamp(rate / TOKENS_PER_SHOT, 0, MAX_RPS)
}

/**
 * 造一发。
 *
 * `jitter` 是 -0.5~0.5 的两个随机数，由调用方给：这个模块不含随机，
 * 于是同样的输入永远给同样的输出，测试才钉得住。
 */
export function spawn(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ch: string,
  jitter: readonly [number, number],
): Bullet {
  return {
    x0: from.x,
    y0: from.y + jitter[0] * 3,
    x1: to.x,
    y1: to.y + jitter[1] * 2,
    t: 0,
    dur: 0.1 + Math.abs(jitter[1]) * 0.05,
    ch,
  }
}

/** 一发此刻在哪。直线——**打的是字不是抛物线**，弧线会让落点读不准。 */
export function posOf(b: Bullet): { x: number; y: number } {
  const u = clamp(b.t / b.dur, 0, 1)
  return { x: b.x0 + (b.x1 - b.x0) * u, y: b.y0 + (b.y1 - b.y0) * u }
}

/**
 * 推进所有子弹，落地的交给 `onLand`。
 *
 * **落地意味着什么由调用方定**：打在纸带上是落一个字，打在敌人身上是掉一点血。
 * 这个模块不认识敌人，所以它不能替谁做这个决定——把回调交出去，
 * 是让「子弹怎么飞」和「打中了算什么」各归各的唯一办法。
 *
 * 原地改数组而不是重建：吐字最快时一秒二十几发，每帧重建数组等于把 GC
 * 拉进热路径，而这个循环每秒要跑六十次。
 */
export function stepShots(bullets: Bullet[], dt: number, onLand: (b: Bullet) => void): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    if (b === undefined) continue
    b.t += dt
    if (b.t < b.dur) continue
    bullets.splice(i, 1)
    onLand(b)
  }
}

/** 落一个字。上限在这儿而不在调用方——它是纸带自己的事。 */
export function pushGlyph(tape: Glyph[], b: Bullet): void {
  tape.push({ x: b.x1, y: b.y1, ch: b.ch, t: 0, gone: 0 })
  while (tape.length > TAPE_MAX) tape.shift()
}

/**
 * 纸带向左漂。`speed` 是每秒多少像素，`left` 是漂到哪儿就没了；`clear` 为真时整条一起淡掉（收工之后）。
 *
 * **静默时漂得快**（调用方给一个更大的 speed）：不然一条不动的字带会一直
 * 挂在那儿，而「空闲整帧不重绘」那条优化就永远等不到「不动」这一刻。
 */
export function stepTape(
  tape: Glyph[],
  dt: number,
  { speed, left, clear = false }: { speed: number; left: number; clear?: boolean },
): void {
  for (let i = tape.length - 1; i >= 0; i--) {
    const g = tape[i]
    if (g === undefined) continue
    g.t += dt
    g.x -= speed * dt
    if (clear) g.gone += dt / TAPE_CLEAR
    if (g.x < left || g.gone >= 1) tape.splice(i, 1)
  }
}
