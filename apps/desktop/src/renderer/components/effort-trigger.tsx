/**
 * 推理强度收起态那颗触发器：几枚小刻度 ＋ 档位名。
 *
 * 从 `EffortSlider.tsx` 拆出来是行数闸门逼的，这一刀也顺：那边管
 * 「展开 / 收起 / 现在是哪一档」的状态机，这边只回答「收起来长什么样」。
 */

/** 用同一墨色与亮起的刻度数量表达档位，颜色不再随强度变化。 */
function Ticks({ count, index }: { count: number; index: number }): React.JSX.Element {
  return (
    <span className="effort__ticks" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i <= index ? "on" : undefined} />
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
      <Ticks count={count} index={index} />
      <span className="trigger__label">{label}</span>
    </button>
  )
}
