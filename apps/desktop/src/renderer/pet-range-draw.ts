import type { Bench } from "./bench.js"
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

/** 流速环画满对应多少 tok/s。**封顶不是限制，是刻度**。 */
const RATE_FULL = 240

export interface RangeShot {
  target: Target
  /** 画多浓。0.18（闲着）到 1（在开火）。见 `pet-range.ts` 的「靶场什么时候显形」。 */
  show: number
  at: { x: number; y: number; ground: number }
  live: { rate: number; speed: number | undefined; ratio: number; bench: Bench | undefined }
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
  // **整张靶的浓度在这一层定**，里面每处自己的半透明都乘上它；
  // 画完还原成 1，后面的枪、子弹、弹壳不跟着淡
  g.globalAlpha = all.show
  post(g, all)
  rings(g, all)
  face(g, all, effOf(live.ratio))
  holes(g, all)
  readout(g, all)
  g.globalAlpha = 1
}

/** 靶杆。**靶得立在台面上**——飘着的一张纸不是靶，是贴纸。 */
function post(g: CanvasRenderingContext2D, { at, pal, show }: RangeShot): void {
  g.globalAlpha = 0.5 * show
  g.fillStyle = pal.faint
  g.fillRect(at.x - 0.5, at.y + TG_R, 1, Math.max(0, at.ground - at.y - TG_R))
  g.globalAlpha = show
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
function face(g: CanvasRenderingContext2D, { at, level, pal, show }: RangeShot, eff: number): void {
  g.fillStyle = pal.line
  round(g, { x: at.x - TG_R, y: at.y - TG_R, w: TG_R * 2, h: TG_R * 2 }, 3)
  g.fill()
  g.globalAlpha = 0.35 * show
  g.fillStyle = level
  g.beginPath()
  g.arc(at.x, at.y, eff, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = show
  g.strokeStyle = level
  g.lineWidth = 1
  g.beginPath()
  g.arc(at.x, at.y, eff, 0, Math.PI * 2)
  g.stroke()
}

/** 弹着：进了的实心，脱靶的空心。**都不消失**——那一串就是这一轮的记录。 */
function holes(g: CanvasRenderingContext2D, { target, at, pal, show }: RangeShot): void {
  for (const hole of target.holes) {
    if (hole.in) {
      g.fillStyle = pal.text
      g.fillRect(at.x + hole.x - 0.85, at.y + hole.y - 0.85, 1.8, 1.8)
      continue
    }
    g.globalAlpha = 0.5 * show
    g.strokeStyle = pal.text
    g.lineWidth = 0.8
    g.strokeRect(at.x + hole.x - 1.1, at.y + hole.y - 1.1, 2.2, 2.2)
    g.globalAlpha = show
  }
}

/**
 * 靶上头那一行。**一行，两种状态，同一个口径**（见 `bench.ts`）：
 *
 * - **在跑**：`≈58 tok/s`。这一轮此刻的生成速度——生成量 ÷ 真在出字的时间。
 *   跑着的时候引擎还没报生成量，所以一定是估的，带 ≈。刚开头那几百毫秒还算不出来，
 *   先印驱动开火的那个滑窗读数，也带 ≈。
 * - **跑完**：`首字 0.62s · 87 tok/s`。上一轮的**成绩**：TTFT 单列，速度不含它。
 *   引擎报得出生成量时它是**真数，不带 ≈**；报不出的那几家仍带。
 *
 * 上一版在跑时印的是滑窗读数（最近 1.2 秒），跑完印的是「首字到末字」的商——两个口径，
 * 一轮里只要调过一次工具，跑完那个数就比跑着时的小一大截，读起来像是「它变慢了」。
 */
function headOf(live: RangeShot["live"]): string {
  if (live.speed !== undefined) return `≈${String(Math.round(live.speed))} tok/s`
  if (live.rate > 1) return `≈${String(Math.round(live.rate))} tok/s`
  const done = live.bench
  if (done === undefined) return "0 tok/s"
  return `首字 ${done.ttft.toFixed(2)}s · ${done.exact ? "" : "≈"}${String(Math.round(done.tps))} tok/s`
}

/**
 * 靶上下两行读数。
 *
 * **只写速度和命中，别的都不写。** 上下文、缓存、累计也都是真数，
 * 但它们不是同一个层级的东西：速度是你一直在扫的，其余是你想起来才查的。
 * 把想起来才查的那些常驻在这儿，等于让每一帧都替一个偶尔的问题付钱。
 */
function readout(g: CanvasRenderingContext2D, { target, at, live, pal }: RangeShot): void {
  const spread = spreadOf(target)
  const pct = target.shots > 0 ? `${String(Math.round((target.hits / target.shots) * 100))}%` : "—"
  g.font = pal.font
  g.textAlign = "center"
  g.textBaseline = "bottom"
  // 在跑用强调色，跑完那个真数用正文色——**估出来的那个不配用正文色**
  g.fillStyle = live.rate > 1 || live.speed !== undefined ? pal.accent : live.bench?.exact === true ? pal.text : pal.faint
  g.fillText(headOf(live), at.x, at.y - TG_R - 14)
  g.fillStyle = pal.faint
  const sd = spread === undefined ? "—" : `±${spread.toFixed(1)}px`
  g.fillText(`${String(target.hits)}/${String(target.shots)} · ${pct} · ${sd}`, at.x, at.y + TG_R + 24)
  g.textAlign = "left"
  g.textBaseline = "alphabetic"
}
