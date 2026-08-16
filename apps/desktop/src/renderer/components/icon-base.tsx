/**
 * 图标。
 *
 * ## 为什么是内联 SVG，不是 emoji、不是字形、不是图标库
 *
 * - **emoji** 是彩色的，和这套单色界面不搭，而且各平台画得不一样。
 * - **字形**（`⌸`、`▾` 之类）在多数字体里会退化成一个含糊的方框。
 * - **图标库**要么进 bundle 几百 KB，要么从 CDN 拉——而这个应用是离线优先的。
 *
 * 内联 SVG 跟着 `currentColor` 走，所以 hover / 选中 / 禁用时颜色自动对，
 * 不用为每种状态各写一份。
 *
 * ## 一套画法
 *
 * 全部 16×16 视口、`stroke-width: 1.3`、圆角端点。混用描边和填充是图标看起来
 * 「不是一套」的最常见原因——所以这里只有描边，唯一的例外是需要表达
 * 「实心状态」的那几个（选中的勾、状态点）。
 */

export const BOX = { viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const

/**
 * 线条属性。**故意不含 `strokeWidth`** —— 那一项由 `Svg` 按尺寸算，见下。
 */
export const LINE = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const

/** 渲染出来的笔画粗细（CSS 像素）。整套图标共用这一个数。 */
const STROKE_PX = 1.25

/**
 * 图标外壳。**「多大」和「多重」在这里解耦。**
 *
 * ## 为什么笔画要跟着尺寸反着算
 *
 * 所有图标共用 `viewBox="0 0 16 16"`，笔画原来写死 1.3。而 `width` 是变的
 * （11、12、13、14、15 都有），于是渲染出来的笔画 = `1.3 × size / 16`：
 *
 * | 渲染尺寸 | 实际笔画 |
 * | --- | --- |
 * | 14 | 1.14 |
 * | 12 | 0.98 |
 * | 11 | 0.89 |
 *
 * 侧栏那一列里 14 和 12 是挨着的，**笔画差 28%**——看起来就是有的粗有的细、
 * 边缘有的实有的虚，整列像没对齐。而且 1.14 这种值永远压在像素边界上，
 * 每个图标都糊一点、还糊得不一样。
 *
 * 现在按尺寸反向补偿：`strokeWidth = STROKE_PX × 16 / size`，
 * 于是不管画多大，**落到屏幕上永远是同一个粗细**。
 * 尺寸继续按位置需要挑，重量不再跟着变。
 */
export function Svg({
  size = 14,
  style,
  children,
}: {
  size?: number
  /** 少数图标要转（展开箭头）。**给它开个口子，而不是让它自己写 `<svg>`**——
      自己写就拿不到上面那套笔画补偿，实测四个图标就是这么漏掉的。 */
  style?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <svg width={size} height={size} strokeWidth={(STROKE_PX * 16) / size} style={style} {...BOX}>
      {children}
    </svg>
  )
}

/**
 * 侧栏那一列图标的尺寸。
 *
 * **同一条竖线上的东西必须一样大。** 原来这一列里混着 14（新建/打开文件夹/设置）
 * 和 12（项目行的展开箭头），两者上下相邻——一大一小，那列就不成其为一条线了。
 *
 * 段头的箭头例外，它属于另一个层级（小一号字的分节标题），用 `SIDEBAR_ICON_SMALL`。
 */
export const SIDEBAR_ICON = 15
export const SIDEBAR_ICON_SMALL = 12
