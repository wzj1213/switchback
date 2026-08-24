/**
 * 条子的几何。**JS 和 CSS 从同一组数出**——`--effort-w` 是 `barWidth` 的结果，
 * 拇指的 20px 和上下那 3px 也在这儿有名字。分出来是行数闸门逼的，
 * 但这一刀顺：这里只有算术，没有任何 React。
 */

/** 条子宽：padding 28 + 每档 30。CSS 的 `--effort-w` 与它是同一个数。 */
export function barWidth(count: number): number {
  return 28 + count * 30
}

/** 拇指直径。`indexAt` 的指针算术和 CSS 的拇指尺寸都从它出。 */
export const THUMB = 20

/**
 * 拇指到条子两端的余量。**和它上下那 3px 是同一个数**——
 * 条子高 26、拇指 20，上下自然各留 3px；横向要是留 0，
 * 拇指走到最左 / 最右就直接贴死在端头上，看着像卡住了、或者掉出去半个。
 * 四边都留 3px，它才是「嵌在槽里的一颗钮」。
 */
export const PAD = 3

/** 拇指能走的那一段：两头各让出 `PAD`。几何只在这里算一次，JS 和 CSS 都从它出。 */
export function travelOf(width: number): number {
  return Math.max(1, width - THUMB - PAD * 2)
}

/**
 * 指针位置 → 档位序号。纯函数，好测。
 * 拇指**边走边走**：有效行程是 `width − THUMB − 2×PAD`，指针先退半个拇指再退一个 `PAD`。
 */
export function indexAt(x: number, width: number, count: number): number {
  if (count <= 1) return 0
  const i = Math.round(((x - PAD - THUMB / 2) / travelOf(width)) * (count - 1))
  return Math.min(count - 1, Math.max(0, i))
}
