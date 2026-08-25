/**
 * 那只爬过来的东西**长什么样**。
 *
 * ## 为什么值得单独烘一张图
 *
 * 身体是一个圆角方块，上面用 `destination-out` 挖两个缺口（被咬掉的那两口），
 * 再补两只眼睛。**`destination-out` 是一次合成操作**——围攻那一档同时有八只，
 * 逐只现画就是每帧八次合成，而这八次画的完全是同一张图。
 * 烘成一张离屏精灵之后每帧只剩八次 `drawImage`。
 *
 * ## 缓存键为什么带主题代数
 *
 * 颜色是从 CSS 变量读来的，换主题就得重烘。原型里那份缓存**只加不删**——
 * 跟随系统主题的机器一天切两次，那张表一天长六项且永不回收。
 * 这里换成「代数一变整张表清空」：同一时刻最多三种怪 × 两种闪白 = 六张。
 */

/** 一只标准个头（slime）的身体边长。蜂群与胖子按 `SCALE` 缩放。 */
export const FOE_R = 22
/** 精灵画布的边长。留出缺口挖到边缘外的余量。 */
const SPRITE = 30
/** 身体在精灵里的落点：脚踩在 `(15, 26)`。 */
const FOOT_X = 15
const FOOT_Y = 26

export interface FoeArtInput {
  kind: string
  /** 身体色。 */
  body: string
  /** 挨打时的闪白色。 */
  flash: boolean
  /** 主题代数。一变就整张表清空。 */
  gen: number
}

interface Baked {
  gen: number
  sprites: Map<string, HTMLCanvasElement>
}

/** 烘好的那几张。**不是模块级可变状态**——由调用方持有一份，见 `createFoeArt`。 */
export interface FoeArt {
  sprite: (input: FoeArtInput) => HTMLCanvasElement | undefined
}

export function createFoeArt(): FoeArt {
  const baked: Baked = { gen: -1, sprites: new Map() }
  return {
    sprite: (input) => {
      if (baked.gen !== input.gen) {
        baked.gen = input.gen
        baked.sprites.clear()
      }
      const key = `${input.kind}|${input.flash ? 1 : 0}`
      const had = baked.sprites.get(key)
      if (had !== undefined) return had
      const made = bake(input)
      if (made !== undefined) baked.sprites.set(key, made)
      return made
    },
  }
}

/** 画一张。返回 `undefined` 只可能是拿不到 2d 上下文（测试环境）。 */
function bake(input: FoeArtInput): HTMLCanvasElement | undefined {
  const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(SPRITE * dpr)
  canvas.height = Math.round(SPRITE * dpr)
  const g = canvas.getContext("2d")
  if (g === null) return undefined
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.translate(FOOT_X, FOOT_Y)
  paint(g, input)
  return canvas
}

function paint(g: CanvasRenderingContext2D, input: FoeArtInput): void {
  g.fillStyle = input.flash ? "#ffffff" : input.body
  round(g, { x: -FOE_R / 2, y: -FOE_R, w: FOE_R, h: FOE_R }, 7.6)
  g.fill()
  // 被咬掉的两口。**挖在右上角**——它是朝着桌宠走的那一侧，
  // 于是「缺的这一口是刚才那一下」读得出方向
  g.globalCompositeOperation = "destination-out"
  bite(g, FOE_R / 2 - 3.4, -FOE_R + 4.6, 4.7)
  bite(g, FOE_R / 2 - 1.2, -FOE_R + 10.4, 2.5)
  g.globalCompositeOperation = "source-over"
  // 闪白那一帧眼睛反过来：整只是白的，眼睛就得是身体色，否则它没有脸
  g.fillStyle = input.flash ? input.body : "#ffffff"
  round(g, { x: -6.8, y: -14.6, w: 3, h: 6.4 }, 1.5)
  g.fill()
  round(g, { x: -0.6, y: -12, w: 2.3, h: 4.3 }, 1.15)
  g.fill()
}

function bite(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 圆角矩形。`roundRect` 在 Electron 里有，但测试环境的 stub 不一定有。 */
export function round(g: CanvasRenderingContext2D, box: Box, r: number): void {
  const { x, y, w, h } = box
  const k = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + k, y)
  g.lineTo(x + w - k, y)
  g.quadraticCurveTo(x + w, y, x + w, y + k)
  g.lineTo(x + w, y + h - k)
  g.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  g.lineTo(x + k, y + h)
  g.quadraticCurveTo(x, y + h, x, y + h - k)
  g.lineTo(x, y + k)
  g.quadraticCurveTo(x, y, x + k, y)
  g.closePath()
}

/** 每种的缩放。**史莱姆是标准个头**，蜂群小一半、胖子大一半。 */
export const SCALE: Readonly<Record<string, number>> = { slime: 1, swarm: 0.5, glut: 1.5 }

/** 精灵画到世界里时的落点尺寸。 */
export const SPRITE_BOX = { size: SPRITE, footX: FOOT_X, footY: FOOT_Y }
