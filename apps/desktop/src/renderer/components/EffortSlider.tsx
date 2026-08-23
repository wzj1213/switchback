import { useRef, useState } from "react"
import type { ModelOption } from "@omni/protocol"
import { currentOf, effortLabel, ultraOf } from "./ModelPicker.js"
import { EffortBar } from "./EffortBar.js"

/**
 * 推理强度的行内滑块。收起时是一段安静的文字加几枚刻度——**不点开也知道
 * 现在在哪一档**；点一下原地长成滑块，拖、点、← → 都能改，Esc 或点别处收起。
 *
 * **只有当前模型报了 `efforts` 才出现**：ACP 那类把强度编进 modelId 的引擎
 * 根本不报——没报就不出现，不是显示一个灰的、点不动的滑块。
 *
 * 它在发送键左边的空地里：条子往左长，空地（弹性槽）吸收宽度，
 * 发送键的 x 一个像素都不动。
 *
 * 展开那条的指针/键盘交互在 `EffortBar.tsx`。
 */

/** 指针位置 → 档位序号。纯函数，好测。 */
export function indexAt(x: number, width: number, count: number): number {
  if (count <= 1) return 0
  const pad = 14
  const span = Math.max(1, width - pad * 2)
  const i = Math.round(((x - pad) / span) * (count - 1))
  return Math.min(count - 1, Math.max(0, i))
}

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

/** 收起态那几枚小刻度：亮到第几格就是第几档，不点开也知道。 */
function Ticks({
  count,
  index,
  color,
}: {
  count: number
  index: number
  /** 深空配色开启时，亮着的刻度染当前档的坡道色。 */
  color?: string
}): React.JSX.Element {
  return (
    <span className="effort__ticks" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          className={i <= index ? "on" : undefined}
          style={color === undefined || i > index ? undefined : { background: color }}
        />
      ))}
    </span>
  )
}

export function EffortSlider({
  current,
  effort,
  disabled,
  onChange,
}: {
  current: ModelOption
  effort: string | undefined
  disabled: boolean
  onChange: (effort: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const trig = useRef<HTMLButtonElement>(null)
  const efforts = current.efforts ?? []
  const value = effort ?? current.defaultEffort ?? efforts[0]
  // 不在清单里的旧值（换过模型）按 0 档画位置、但标签照原文显示——不编一个档位
  const committed = Math.max(0, efforts.indexOf(value ?? ""))
  // 深空处理只在 ultra 落档时出现——它是这一行里唯一明显改变花销的档
  //（EFFORT 表里只有它带「更快消耗使用额度」）。没报 ultra 的模型永远没有
  const ultra = ultraOf([current], current.id, effort)
  if (efforts.length === 0) return null
  return (
    <span
      className={`effort${open ? " effort--open" : ""}${ultra ? " effort--ultra" : ""}`}
      style={{ "--effort-w": `${String(28 + efforts.length * 30)}px` } as React.CSSProperties}
    >
      {open ? (
        <EffortBar
          efforts={efforts}
          committed={committed}
          onCommit={(index) => {
            const next = efforts[index]
            if (next !== undefined && index !== committed) onChange(next)
          }}
          onClose={(refocus) => {
            setOpen(false)
            // 触发器要等收起重渲染之后才在
            if (refocus) {
              requestAnimationFrame(() => {
                trig.current?.focus()
              })
            }
          }}
        />
      ) : (
        <button
          type="button"
          ref={trig}
          className="trigger"
          title="推理强度"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => {
            setOpen(true)
          }}
        >
          <Ticks
            count={efforts.length}
            index={committed}
            color={ultra ? voidAt(1) : undefined}
          />
          <span className="trigger__label">
            {value === undefined ? "默认" : effortLabel(value).label}
          </span>
        </button>
      )}
    </span>
  )
}

/** 接线版：从清单里解出当前模型，没解出来（或没报 efforts）就整块不出现。 */
export function BarEffort({
  models,
  model,
  effort,
  disabled,
  onChange,
}: {
  models: readonly ModelOption[]
  model: string | undefined
  effort: string | undefined
  disabled: boolean
  onChange: (model: string, effort: string) => void
}): React.JSX.Element | null {
  const current = currentOf(models, model)
  if (current === undefined) return null
  return (
    <EffortSlider
      current={current}
      effort={effort}
      disabled={disabled}
      onChange={(next) => {
        onChange(current.id, next)
      }}
    />
  )
}
