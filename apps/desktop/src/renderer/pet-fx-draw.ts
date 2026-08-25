import { muzzleOf, type FxWorld } from "./pet-fx.js"
import { posOf } from "./pet-shots.js"

/**
 * 开火那一层怎么画。**只读状态，不改状态**——推进在 `pet-fx.ts`。
 *
 * 分成两个文件不是洁癖：**空闲时要跳过绘制而不能跳过推进**（理由见 `pet-fx.ts`），
 * 而两件事写在一个函数里的话，"跳过" 就只能是全跳或全不跳。
 *
 * ## 颜色为什么要缓存
 *
 * `getComputedStyle` 是一次强制样式计算。这里有六七种颜色，逐帧现查等于
 * 每帧付六七次——而它们只在换主题时变。`Palette` 由调用方按主题代数重建一次。
 */

/** 落到纸带上的那些字。**是真的字，不是符号**：产出看起来该像产出。 */
const CHARS = "模型上下文进度环token流速引擎会话const{}=>();return"

export interface Palette {
  /** 敌人的底色。**和五家的配色无关**——它们是压力，不是哪一家。 */
  foe: string
  gun: string
  gunHi: string
  gunDark: string
  spark: string
  glyph: string
  /** 当前引擎的颜色。子弹用它——**弹丸是那家引擎打出去的**。 */
  engine: string
  font: string
}

/** 读一次调色板。换主题、换引擎时重建，不要每帧调。 */
export function readPalette(root: HTMLElement, tone: string): Palette {
  const cs = getComputedStyle(root)
  const get = (name: string): string => cs.getPropertyValue(name).trim()
  return {
    foe: get("--pet-foe"),
    gun: get("--pet-gun"),
    gunHi: get("--pet-gun-hi"),
    gunDark: get("--pet-gun-dk"),
    spark: get("--pet-spark"),
    glyph: get("--text-faint"),
    engine: get(`--pet-${tone}`),
    font: `500 9px ${cs.fontFamily}`,
  }
}

/**
 * 枪的形。局部坐标，**枪管朝 -x**，手心在原点。
 *
 * 逐格写死而不是画路径：这一套的美术全是像素块（见 `pets-art.tsx`），
 * 一把带弧度的枪摆在几只方块史莱姆中间会显得是从别处贴来的。
 */
const BODY: readonly (readonly [number, number, number, number, keyof Palette])[] = [
  [-11, -1.5, 9, 3, "gun"], // 枪管
  [-2, -3, 6, 6, "gunHi"], // 机匣
  [-1, 2, 3, 4, "gunDark"], // 弹匣
  [3, -1, 3, 2, "gunDark"], // 枪托
  [-4, -2.5, 2, 1.5, "gunHi"], // 准星那一小块
]

export function drawFx(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  drawTape(g, w, pal)
  drawFoes(g, w, pal)
  drawBullets(g, w, pal)
  if (w.gun.arm > 0.01) drawGun(g, w, pal)
}

/**
 * 那些爬过来的。
 *
 * 三种形只差两笔：**史莱姆是方的、蜂群是小的、胖子是大的**。
 * 再多的差别没有意义——它们要说的是「哪一种压力」，而那件事靠尺寸和数量
 * 已经说完了；画得越细，越像在做一个游戏，而这不是游戏。
 */
function drawFoes(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  for (const f of w.foes) {
    const s = f.kind === "swarm" ? 7 : f.kind === "glut" ? 20 : 13
    const fade = f.dying > 0 ? Math.max(0, 1 - f.dying / 0.55) : 1
    g.globalAlpha = fade * 0.9
    g.fillStyle = f.flash > 0 ? pal.gunHi : pal.foe
    const x = f.x + f.knock
    const y = f.y - f.fly - s
    g.fillRect(x - s / 2, y, s, s)
    // 血条只在挨过打之后出现：**没挨过打的那只不该先摆一条满血给你看**
    if (f.hp < f.hp0 && f.dying === 0) {
      g.globalAlpha = fade * 0.55
      g.fillStyle = pal.spark
      g.fillRect(x - s / 2, y - 3, (s * f.hp) / f.hp0, 1.5)
    }
  }
  g.globalAlpha = 1
}

function drawTape(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  if (w.tape.length === 0) return
  g.font = pal.font
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillStyle = pal.glyph
  for (const glyph of w.tape) {
    // 刚落下的那一下弹一下，之后归位。**弹的是刚到的那个字**，
    // 不然一条静止的字带说不出「这一个是新的」
    const pop = glyph.t < 0.09 ? 1 + (1 - glyph.t / 0.09) * 0.7 : 1
    g.globalAlpha = 0.85
    if (pop === 1) {
      g.fillText(CHARS[glyph.ch % CHARS.length] ?? "·", glyph.x, glyph.y)
      continue
    }
    g.save()
    g.translate(glyph.x, glyph.y)
    g.scale(pop, pop)
    g.fillText(CHARS[glyph.ch % CHARS.length] ?? "·", 0, 0)
    g.restore()
  }
  g.globalAlpha = 1
}

function drawBullets(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  if (w.bullets.length === 0) return
  g.fillStyle = pal.engine
  for (const b of w.bullets) {
    const p = posOf(b)
    g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
  }
}

function drawGun(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  const { gun } = w
  // 收着的时候枪口朝下、缩小、淡出。**插值而不是两张图**：
  // 中间那几帧正是「正在抽 / 正在收」，没有它就成了瞬移
  const e = gun.arm < 1 ? 1 - (1 - gun.arm) ** 3 : 1
  const stow = Math.PI * 0.46
  const ang = gun.ang + gun.kick
  g.save()
  g.globalAlpha = Math.min(1, gun.arm * 1.7)
  g.translate(gun.x, gun.y)
  g.rotate(ang + (stow - ang) * (1 - e))
  g.scale(0.82 + 0.18 * e, 0.82 + 0.18 * e)
  for (const [x, y, bw, bh, key] of BODY) {
    g.fillStyle = pal[key]
    g.fillRect(x, y, bw, bh)
  }
  g.restore()
  if (gun.kick > 0.05) flash(g, w, pal)
}

/** 枪口焰。**跟着后坐的大小而不是每发都一样**：连发时它才会连成一片。 */
function flash(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  const m = muzzleOf(w.gun)
  const r = 2 + w.gun.kick * 14
  g.globalAlpha = Math.min(0.9, w.gun.kick * 4)
  g.fillStyle = pal.spark
  g.beginPath()
  g.arc(m.x, m.y, r, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1
}
