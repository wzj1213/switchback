import { useId } from "react"

/**
 * 贵档那圈边。**描边取的是同一条深空坡道**（靛 → 紫 → 品红），不是一色品红：
 * 一色品红说的是「警告」，而条子上是一片星空——两处对不上，就成了两件事。
 *
 * 停点的颜色写在 CSS 里（`.compring__s0/1/2` 的 `stop-color`），深色模式才好整组换。
 * 绕圈那一段共用同一条渐变，所以它转到哪儿就带哪一段的颜色，
 * 不是一枚固定颜色的光点在跑。
 *
 * `id` 走 `useId`：一屏可能同时挂着不止一个输入框，写死 id 的话
 * **先卸载的那个会把 `<defs>` 一起带走**，剩下那个的描边直接变成没有。
 */
export function ComposerRing(): React.JSX.Element {
  const id = useId()
  return (
    <svg className="compring" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop className="compring__s0" offset="0%" />
          <stop className="compring__s1" offset="48%" />
          <stop className="compring__s2" offset="100%" />
        </linearGradient>
      </defs>
      <rect className="compring__edge" style={{ stroke: `url(#${id})` }} />
      <rect className="compring__orbit" style={{ stroke: `url(#${id})` }} pathLength={100} />
    </svg>
  )
}
