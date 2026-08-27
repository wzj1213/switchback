import { fadeOf, type Brass } from "./pet-brass.js"
import { drawFoes, type FoeArtSlot } from "./pet-foe-draw.js"
import { muzzleOf, tapeAt, targetAt, type FxWorld } from "./pet-fx.js"
import { drawRange } from "./pet-range-draw.js"
import { posOf } from "./pet-shots.js"

/**
 * 开火那一层怎么画。**只读状态，不改状态**——推进在 `pet-fx.ts`。
 *
 * 分成两个文件不是洁癖：**空闲时要跳过绘制而不能跳过推进**（理由见 `pet-fx.ts`），
 * 而两件事写在一个函数里的话，"跳过" 就只能是全跳或全不跳。
 *
 * ## 颜色为什么要缓存
 *
 * `getComputedStyle` 是一次强制样式计算。这里有十来种颜色，逐帧现查等于
 * 每帧付十来次——而它们只在换主题时变。`Palette` 由调用方按主题代数重建一次。
 */

/** 落到纸带上的那些字。**是真的字，不是符号**：产出看起来该像产出。 */
const CHARS = "模型上下文进度环token流速引擎会话const{}=>();return"

export interface Palette {
  /** 敌人的底色。**和五家的配色无关**——它们是压力，不是哪一家。 */
  foe: string
  foeDrip: string
  gun: string
  gunHi: string
  gunDark: string
  spark: string
  brass: string
  glyph: string
  line: string
  text: string
  warn: string
  danger: string
  /** 当前引擎的颜色。子弹用它——**弹丸是那家引擎打出去的**。 */
  engine: string
  font: string
  small: string
}

/** 读一次调色板。换主题、换引擎时重建，不要每帧调。 */
export function readPalette(root: HTMLElement, tone: string): Palette {
  const cs = getComputedStyle(root)
  /**
   * **读不到就给一个看得见的兜底，不能给空串。**
   *
   * canvas 的 `fillStyle = ""` 是**无效赋值**——它不报错，也不改颜色，
   * 而是**留用上一笔**。于是一个拼错的 token 名会表现为「某个东西莫名其妙
   * 变成了旁边那个东西的颜色」，在一张每帧重画的画布上几乎不可能定位。
   * `check-tokens.mjs` 已经在构建期守着定义，这一层是给运行期兜底的。
   */
  const get = (name: string): string => {
    const value = cs.getPropertyValue(name).trim()
    return value === "" ? "#888888" : value
  }
  return {
    foe: get("--pet-foe"),
    foeDrip: get("--pet-foe-drip"),
    gun: get("--pet-gun"),
    gunHi: get("--pet-gun-hi"),
    gunDark: get("--pet-gun-dk"),
    spark: get("--pet-spark"),
    brass: get("--pet-brass"),
    glyph: get("--text-faint"),
    line: get("--bg-active"),
    text: get("--text"),
    warn: get("--warn"),
    danger: get("--danger"),
    engine: get(`--pet-${tone}`),
    font: `500 9px ${cs.fontFamily}`,
    small: `500 10px ${cs.fontFamily}`,
  }
}

/**
 * 枪的形。局部坐标，**素材的枪管指 -x**，手心在原点。
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

export interface DrawKit {
  art: FoeArtSlot["art"]
  gen: number
  range: boolean
}

export function drawFx(
  g: CanvasRenderingContext2D,
  w: FxWorld,
  pal: Palette,
  kit: DrawKit,
): void {
  if (kit.range) drawTarget(g, w, pal)
  else drawTape(g, w, pal)
  drawFoes(g, w.foes, { foe: pal.foe, drip: pal.foeDrip, bar: pal.spark }, { art: kit.art, gen: kit.gen })
  drawBrass(g, w.brass, pal)
  drawBullets(g, w, pal)
  if (w.gun.arm > 0.01) drawGun(g, w, pal)
}

function drawTarget(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  const { view } = w
  // **靶从 `view.stand` 算，不从手算**：一张跟着枪走的靶量不出任何东西，
  // 而靶杆也得立在台面的地面线上，不是那只此刻的脚下（见 `pet-range.ts` 开头）
  const at = targetAt(view.stand)
  drawRange(g, {
    target: w.target,
    show: w.show.on,
    at: { x: at.x, y: at.y, ground: view.stand.ground },
    live: { rate: view.rate, ratio: view.ratio, bench: view.bench },
    pal: {
      line: pal.line,
      faint: pal.glyph,
      text: pal.text,
      accent: pal.engine,
      warn: pal.warn,
      danger: pal.danger,
      font: pal.small,
    },
  })
}

/** 左端这一段里字要淡出去。**它是「纸带在往那头走」唯一的说法。** */
const TAPE_FADE = 70

function drawTape(g: CanvasRenderingContext2D, w: FxWorld, pal: Palette): void {
  if (w.tape.length === 0) return
  const { view } = w
  const edge = tapeAt({ x: view.handX, y: view.handY })
  // 纸带那条底线。**先画线再画字**：没有这条线，那串字看起来是浮在空气里的，
  // 而「带」这个字的意思全在这条线上
  g.globalAlpha = 0.13
  g.fillStyle = pal.text
  g.fillRect(edge.left, edge.y + 6.5, edge.x - edge.left, 1)
  g.font = pal.font
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillStyle = pal.glyph
  for (const glyph of w.tape) {
    // 刚落下的那一下弹一下，之后归位。**弹的是刚到的那个字**，
    // 不然一条静止的字带说不出「这一个是新的」
    const pop = glyph.t < 0.09 ? 1 + (1 - glyph.t / 0.09) * 0.7 : 1
    // 走到左端就淡掉。**不是「到点消失」**——那样每个字都是啪一下没的，
    // 一条本该在流动的带子会读成一排在闪的字
    g.globalAlpha = Math.min(1, Math.max(0, (glyph.x - edge.left) / TAPE_FADE)) * 0.85
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
  g.textAlign = "left"
  g.textBaseline = "alphabetic"
}

/**
 * 弹壳。**抛出去那一路会淡出，堆着那一路不淡**——
 * 堆着的意义正是「它还在那儿」，淡掉就成了另一个东西。
 */
function drawBrass(g: CanvasRenderingContext2D, brass: Brass, pal: Palette): void {
  g.fillStyle = pal.brass
  for (const c of brass.flying) {
    g.globalAlpha = Math.max(0, Math.min(1, (1 - c.t) * 1.6))
    shell(g, c)
  }
  for (const c of brass.pile) {
    // 淡多少由 `pet-brass` 算：那儿知道寿命是多长，这儿只管画
    g.globalAlpha = fadeOf(c)
    shell(g, c)
  }
  g.globalAlpha = 1
}

function shell(g: CanvasRenderingContext2D, c: { x: number; y: number; r: number }): void {
  g.save()
  g.translate(c.x, c.y)
  g.rotate(c.r)
  g.fillRect(-1.6, -1, 3.2, 2)
  g.restore()
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
  // **整体转 `ang + π`。** 素材的枪管指 -x，只转 `ang` 的话枪管会指到瞄准
  // 方向的正反面去——上一版就是这样：人朝左打，枪横在身上朝右，
  // 枪口焰独自出现在左边，看起来像是从别处贴来的一团火。
  // 不能用 `scale(-1,1)` 去翻：镜像加旋转是个反射，角度的正负会整个反过来
  g.rotate(ang + (stow - ang) * (1 - e) + Math.PI)
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
