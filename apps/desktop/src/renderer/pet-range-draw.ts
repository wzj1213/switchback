import { round } from "./pet-foe-art.js"
import { effOf, spreadOf, TG_R, type Target } from "./pet-range.js"

/**
 * 靶怎么画。
 *
 * ## 靶子和上下文条是同一件事的两种写法
 *
 * 两道弧同心：**里面那圈是流速**（此刻吐多快），**外面那圈是上下文占用**
 * ——和顶栏那条、输入框那枚 12px 环取的是同一个数、同一套档位（70% 黄 / 90% 红）。
 * 里面在动＝在吐字，外面在涨＝快满了，一眼能看出这两件事是不是同时在发生。
 *
 * 靶纸上那圈**有效区**是上下文吃掉之后剩下的：进了它才算命中。
 * 这不是给谁开的后门——上下文变满本来就是真实的能力衰减（见 `pet-range.ts`）。
 */

export interface RangePaint {
  line: string
  faint: string
  text: string
  accent: string
  warn: string
  danger: string
  font: string
}

/** 流速环画满对应多少 t/s。**封顶不是限制，是刻度**。 */
const RATE_FULL = 240

export interface RangeShot {
  target: Target
  at: { x: number; y: number; ground: number }
  live: { rate: number; ratio: number }
  pal: RangePaint
  /** 上下文那一档对应的颜色。**和顶栏那条 meter 同一套档位**（70% 黄 / 90% 红）。 */
  level: string
}

export function drawRange(
  g: CanvasRenderingContext2D,
  shot: Omit<RangeShot, "level">,
): void {
  const { live, pal } = shot
  const level = live.ratio >= 0.9 ? pal.danger : live.ratio >= 0.7 ? pal.warn : pal.faint
  const all: RangeShot = { ...shot, level }
  post(g, all)
  rings(g, all)
  face(g, all, effOf(live.ratio))
  holes(g, all)
  readout(g, all)
}

/** 靶杆。**靶得立在台面上**——飘着的一张纸不是靶，是贴纸。 */
function post(g: CanvasRenderingContext2D, { at, pal }: RangeShot): void {
  g.globalAlpha = 0.5
  g.fillStyle = pal.faint
  g.fillRect(at.x - 0.5, at.y + TG_R, 1, Math.max(0, at.ground - at.y - TG_R))
  g.globalAlpha = 1
}

function rings(g: CanvasRenderingContext2D, { at, live, level, pal }: RangeShot): void {
  const r1 = TG_R + 4.5
  const r2 = TG_R + 9
  g.lineCap = "round"
  g.lineWidth = 2.2
  arc(g, at, { r: r1, part: 1 }, pal.line)
  const fr = Math.min(1, Math.max(0, live.rate / RATE_FULL))
  if (fr > 0.001) arc(g, at, { r: r1, part: fr }, pal.accent)
  g.lineWidth = 1.8
  arc(g, at, { r: r2, part: 1 }, pal.line)
  arc(g, at, { r: r2, part: Math.min(1, Math.max(0, live.ratio)) }, level)
  g.lineCap = "butt"
}

function arc(
  g: CanvasRenderingContext2D,
  at: { x: number; y: number },
  ring: { r: number; part: number },
  color: string,
): void {
  const { r, part } = ring
  g.strokeStyle = color
  g.beginPath()
  g.arc(at.x, at.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * part)
  g.stroke()
}

/** 靶纸：一圈外框，中间是**上下文吃剩的有效区**。 */
function face(g: CanvasRenderingContext2D, { at, level, pal }: RangeShot, eff: number): void {
  g.fillStyle = pal.line
  round(g, { x: at.x - TG_R, y: at.y - TG_R, w: TG_R * 2, h: TG_R * 2 }, 3)
  g.fill()
  g.globalAlpha = 0.35
  g.fillStyle = level
  g.beginPath()
  g.arc(at.x, at.y, eff, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1
  g.strokeStyle = level
  g.lineWidth = 1
  g.beginPath()
  g.arc(at.x, at.y, eff, 0, Math.PI * 2)
  g.stroke()
}

/** 弹着：进了的实心，脱靶的空心。**都不消失**——那一串就是这一轮的记录。 */
function holes(g: CanvasRenderingContext2D, { target, at, pal }: RangeShot): void {
  for (const hole of target.holes) {
    if (hole.in) {
      g.fillStyle = pal.text
      g.fillRect(at.x + hole.x - 0.85, at.y + hole.y - 0.85, 1.8, 1.8)
      continue
    }
    g.globalAlpha = 0.5
    g.strokeStyle = pal.text
    g.lineWidth = 0.8
    g.strokeRect(at.x + hole.x - 1.1, at.y + hole.y - 1.1, 2.2, 2.2)
    g.globalAlpha = 1
  }
}

/**
 * 靶上头那一行。
 *
 * **只写流速和命中，别的都不写。** 上下文、缓存、累计也都是真数，
 * 但它们不是同一个层级的东西：流速是你一直在扫的，其余是你想起来才查的。
 * 把想起来才查的那些常驻在这儿，等于让每一帧都替一个偶尔的问题付钱。
 */
function readout(g: CanvasRenderingContext2D, { target, at, live, pal }: RangeShot): void {
  const spread = spreadOf(target)
  const pct = target.shots > 0 ? `${String(Math.round((target.hits / target.shots) * 100))}%` : "—"
  g.font = pal.font
  g.textAlign = "center"
  g.textBaseline = "bottom"
  g.fillStyle = live.rate > 1 ? pal.accent : pal.faint
  g.fillText(`${live.rate > 1 ? `~${String(Math.round(live.rate))}` : "0"} t/s`, at.x, at.y - TG_R - 14)
  g.fillStyle = pal.faint
  const sd = spread === undefined ? "—" : `±${spread.toFixed(1)}px`
  g.fillText(`${String(target.hits)}/${String(target.shots)} · ${pct} · ${sd}`, at.x, at.y + TG_R + 24)
  g.textAlign = "left"
  g.textBaseline = "alphabetic"
}
