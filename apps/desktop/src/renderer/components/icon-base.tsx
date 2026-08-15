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
export const LINE = { stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } as const

export function Svg({ size = 14, children }: { size?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} {...BOX}>
      {children}
    </svg>
  )
}
