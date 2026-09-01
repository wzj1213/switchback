/**
 * 推理强度收起态那颗触发器：几枚小刻度 ＋ 档位名。
 *
 * 从 `EffortSlider.tsx` 拆出来是行数闸门逼的，这一刀也顺：那边管
 * 「展开 / 收起 / 现在是哪一档」的状态机，这边只回答「收起来长什么样」。
 */

/** 深空配色的坡道：靛 → 紫 → 品红。三站线性插值，和 CSS 里那条渐变同一组值。 */
function voidAt(t: number): string {
  type Rgb = readonly [number, number, number]
  const stops: [Rgb, Rgb, Rgb] = [
    [0x2b, 0x2d, 0x6e],
    [0x6d, 0x4b, 0xc7],
    [0xb4, 0x40, 0x9a],
  ]
  const x = Math.min(1, Math.max(0, t)) * 2
  const i = x >= 1 ? 1 : 0
  const from = i === 0 ? stops[0] : stops[1]
  const to = i === 0 ? stops[1] : stops[2]
  const f = x - i
  return `rgb(${String(Math.round(from[0] + (to[0] - from[0]) * f))} ${String(
    Math.round(from[1] + (to[1] - from[1]) * f),
  )} ${String(Math.round(from[2] + (to[2] - from[2]) * f))})`
}

/**
 * 收起态那几枚小刻度：亮到第几格就是第几档，不点开也知道。
 *
 * **贵档时每一枚各染各的位置色**（`voidAt(i / (count-1))`），不是整排刷成品红：
 * 那样一排六枚同色，等于把「更贵」这句话在 24px 里说了六遍，
 * 而且和展开后那条坡道对不上——收起和展开说的得是同一件事，
 * 收起态就是那条坡道**降采样到几个像素**的样子。
 */
function Ticks({
  count,
  index,
  costly,
}: {
  count: number
  index: number
  /** 贵档落档：亮着的那几枚按各自的位置取坡道色。 */
  costly: boolean
}): React.JSX.Element {
  return (
    <span className="effort__ticks" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          className={i <= index ? "on" : undefined}
          style={
            costly && i <= index
              ? { background: voidAt(count < 2 ? 1 : i / (count - 1)) }
              : undefined
          }
        />
      ))}
    </span>
  )
}

/** 收起态的触发器：几枚小刻度 ＋ 档位名。 */
export function EffortTrigger({
  count,
  index,
  costly,
  label,
  disabled,
  trig,
  onOpen,
}: {
  count: number
  index: number
  costly: boolean
  label: string
  disabled: boolean
  trig: React.RefObject<HTMLButtonElement | null>
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      ref={trig}
      className="trigger"
      /* 贵档时那句话进 title：**它不再常驻浮在正文上方**（会压住正在打的字），
         改成停一下才出来的那张小卡（见 `.effort__warn`）。 */
      title={costly ? "超高：更快消耗使用额度" : "推理强度"}
      disabled={disabled}
      aria-expanded={false}
      onClick={onOpen}
    >
      <Ticks count={count} index={index} costly={costly} />
      <span className="trigger__label">{label}</span>
    </button>
  )
}
