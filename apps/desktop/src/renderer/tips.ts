/**
 * 悬停提示摆在哪儿。**纯几何**：给一个触发器的矩形和窗口大小，算出落点。
 *
 * 抽出来是为了能用一张表把边界钉住——贴着窗口顶边的按钮（顶栏那一排）、
 * 贴着左边的（侧栏那一列）、贴着右下角的（输入框右下那颗发送）各是一种情形，
 * 而这些恰恰是自动化出图最难摆出来的位置。
 */

export interface TipBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** 提示离触发器多远。 */
const GAP = 8
/** 离窗口边至少留多少。 */
const EDGE = 6
/** 牌子还没量出来那一刻先按这个估。**只用于夹边与翻面**，真实大小由内容定。 */
const GUESS = { width: 160, height: 26 }

/**
 * 默认在**上方居中**，装不下就翻到下方。
 *
 * 为什么默认朝上：只有图标的按钮多半排在一条工具栏里，而工具栏下面通常
 * 紧接着就是内容——朝下弹会盖住你正要看的东西；朝上弹盖住的是另一条工具栏
 * 的空隙。顶栏那一排是唯一的例外，那时上面没地方，翻下来。
 *
 * `size` 是牌子量出来的大小（`TipLayer` 画出第一帧之前量好再摆）。长提示会在
 * 260 处折成两三行，还拿估的 160 去夹的话，贴着右边的那几颗会把牌子探出窗口半截。
 */
export function tipSpot(
  box: TipBox,
  view: { width: number; height: number },
  size: { width: number; height: number } = GUESS,
): { left: number; top: number; side: "top" | "bottom" } {
  const above = box.top - GAP - size.height
  const side = above >= EDGE ? "top" : "bottom"
  const top = side === "top" ? box.top - GAP : box.bottom + GAP
  const middle = (box.left + box.right) / 2
  const left = Math.max(
    EDGE + size.width / 2,
    Math.min(middle, view.width - EDGE - size.width / 2),
  )
  return { left, top, side }
}
