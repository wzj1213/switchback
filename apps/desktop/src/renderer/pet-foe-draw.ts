import { FOE_R, SCALE, SPRITE_BOX, type createFoeArt } from "./pet-foe-art.js"
import type { Foe } from "./pet-foes.js"

/**
 * 那些爬过来的**怎么画**。
 *
 * ## 上一版为什么读起来像占位图
 *
 * 它是 `fillRect` 一个方块。三种怪只差边长——而「差别只在尺寸」这句话
 * 当初是当成克制写下来的（「画得越细越像在做一个游戏」），实际效果是
 * **它们看起来像还没画完**：没有脸、没有影子、不摇不晃，
 * 于是那句「敌人是压力的化身」在画面上一个字都没兑现。
 *
 * 现在照原型来，而每一笔都还是那句克制的推论：
 *
 * - **身子上缺两口**——它是被打过的，缺口朝着桌宠那一侧，
 *   于是「刚才那一下从哪来」读得出方向；
 * - **两只眼睛**——有脸才有「它在朝你走」，没脸的方块只是在平移；
 * - **一边走一边颠、身子微微歪**——活的东西没有匀速直线运动；
 * - **脚下一枚影子**——和桌宠那几只用的是同一条规矩：影子是「它在地上」
 *   唯一的说法（见 `petPaint.ts`）；
 * - **蜂群多两片翅膀**，因为它是唯一离地的那种。
 *
 * 身体本身烘成离屏精灵，理由见 `pet-foe-art.ts`。
 */

export interface FoePaint {
  /** 身体色。 */
  foe: string
  /** 蜂群与那道流挂的颜色。**比身体亮一档**——它是同一族的另一种。 */
  drip: string
  /** 挨打时血条的颜色。 */
  bar: string
}

export interface FoeArtSlot {
  art: ReturnType<typeof createFoeArt>
  gen: number
}

/** 死掉那一下压扁到什么程度算演完。 */
const DIE = 0.34

export function drawFoes(
  g: CanvasRenderingContext2D,
  foes: readonly Foe[],
  pal: FoePaint,
  slot: FoeArtSlot,
): void {
  // 从左往右画：缺口是往自己右上角挖的，右边那只后画，挖的才是空地
  const order = [...foes].sort((a, b) => a.x - b.x)
  for (const foe of order) drawOne(g, foe, pal, slot)
  g.globalAlpha = 1
}

function drawOne(
  g: CanvasRenderingContext2D,
  f: Foe,
  pal: FoePaint,
  slot: FoeArtSlot,
): void {
  const body = f.kind === "swarm" ? pal.drip : pal.foe
  const die = f.dying > 0 ? Math.min(1, f.dying / DIE) : 0
  if (die < 1) drawBody(g, f, { color: { body, drip: pal.drip }, slot, die })
  if (f.dying === 0 && f.hp < f.hp0) drawBar(g, f, pal.bar)
  drawParts(g, f, body)
}

interface BodyShot {
  color: { body: string; drip: string }
  slot: FoeArtSlot
  /** 死掉那一下演到几成（0~1）。 */
  die: number
}

function drawBody(g: CanvasRenderingContext2D, f: Foe, shot: BodyShot): void {
  const { color, slot, die } = shot
  const sc = SCALE[f.kind] ?? 1
  const x = f.x + f.knock
  const y = f.y - f.fly
  // 影子钉在地上，不跟着飞——飞着的那种影子更淡更小
  g.globalAlpha = (f.fly > 0 ? 0.1 : 0.22) * (1 - die)
  g.fillStyle = "#000000"
  g.beginPath()
  g.ellipse(x, f.y + 1, 11 * sc, 3 * sc, 0, 0, Math.PI * 2)
  g.fill()
  if (f.kind === "swarm") drawWings(g, f, { color: color.drip, sc, die })
  const sprite = slot.art.sprite({ kind: f.kind, body: color.body, flash: f.flash > 0, gen: slot.gen })
  if (sprite === undefined) return
  g.save()
  g.translate(x, y - Math.abs(Math.sin(f.age * 5.4)) * 2.4)
  g.rotate(0.11 + Math.sin(f.age * 2.7) * 0.085)
  g.scale((1 + die * 0.55) * sc, Math.max(0.02, 1 - die * 1.15) * sc)
  g.globalAlpha = 1 - die * 0.5
  const { size, footX, footY } = SPRITE_BOX
  g.drawImage(sprite, -footX, -footY, size, size)
  // 挂下来的那道。它是这一族唯一一处在动的细节，慢到不抢眼
  g.fillStyle = color.drip
  g.fillRect(-2.6, -6.4, 1.7, 2.6 + Math.sin(f.age * 3.1) * 1.3)
  g.restore()
  g.globalAlpha = 1
}

/** 翅膀。两片，扇得很快——**蜂群是唯一离地的那种**，得有个理由离地。 */
function drawWings(
  g: CanvasRenderingContext2D,
  f: Foe,
  shot: { color: string; sc: number; die: number },
): void {
  const { color, sc, die } = shot
  const x = f.x + f.knock
  const y = f.y - f.fly - FOE_R * sc * 0.72
  const w = Math.abs(Math.sin(f.age * 22)) * 3.4 + 1.6
  g.globalAlpha = 0.5 * (1 - die)
  g.fillStyle = color
  // **展开的距离不跟着身体缩放。** 蜂群的身体只有半个个头，翅膀再按 0.5 缩一次
  // 就只剩三个像素、贴在身上——那时候画面上只有一团抖动的绿点，读不出「它在飞」，
  // 而「飞」正是这一种和另外两种唯一的形上差别
  g.fillRect(x - 7, y, -w, 1.6)
  g.fillRect(x + 7, y, w, 1.6)
}

/** 血条只在挨过打之后出现：**没挨过打的那只不该先摆一条满血给你看**。 */
function drawBar(g: CanvasRenderingContext2D, f: Foe, color: string): void {
  const sc = SCALE[f.kind] ?? 1
  const w = FOE_R * sc
  const x = f.x + f.knock - w / 2
  const y = f.y - f.fly - FOE_R * sc - 4
  g.globalAlpha = 0.55
  g.fillStyle = color
  g.fillRect(x, y, (w * f.hp) / f.hp0, 1.5)
  g.globalAlpha = 1
}

/** 崩出来的碎屑。**打中了的那一帧就在**——血条要挨过打才出现，它不用。 */
function drawParts(g: CanvasRenderingContext2D, f: Foe, body: string): void {
  if (f.parts.length === 0) return
  g.fillStyle = body
  for (const p of f.parts) {
    g.globalAlpha = Math.max(0, Math.min(1, 1 - p.t / p.d))
    g.fillRect(p.x - 1, p.y - 1, 2, 2)
  }
  g.globalAlpha = 1
}
