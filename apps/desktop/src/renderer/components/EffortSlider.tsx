import { useRef, useState } from "react"
import type { ModelOption } from "@omni/protocol"
import { currentOf, effortLabel, costlyOf } from "./ModelPicker.js"
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
 * 条子的布局与全部状态照 `docs/` 比稿那版行内条（gbar）：
 * 白拇指边走边走、填充盖到拇指右缘、坡道钉在整条坐标上、生长靠
 * `clip-path` 保持胶囊形、拖动期零过渡。展开那条的交互在 `EffortBar.tsx`。
 */

/** 条子宽：padding 28 + 每档 30。CSS 的 `--effort-w` 与它是同一个数。 */
export function barWidth(count: number): number {
  return 28 + count * 30
}

/** 拇指直径。`indexAt` 的指针算术和 CSS 的拇指尺寸都从它出。 */
export const THUMB = 20

/**
 * 指针位置 → 档位序号。纯函数，好测。
 * 拇指**边走边走**：有效行程是 `width - THUMB`，指针先退半个拇指。
 */
export function indexAt(x: number, width: number, count: number): number {
  if (count <= 1) return 0
  const travel = Math.max(1, width - THUMB)
  const i = Math.round(((x - THUMB / 2) / travel) * (count - 1))
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
          style={costly && i <= index ? { background: voidAt(count < 2 ? 1 : i / (count - 1)) } : undefined}
        />
      ))}
    </span>
  )
}

/** 收起态的触发器：几枚小刻度 + 档位名。 */
function EffortTrigger({
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

/** 提交那一档：没变或序号越界就不发命令。 */
function committer(
  efforts: readonly string[],
  committed: number,
  onChange: (effort: string) => void,
): (index: number) => void {
  return (index) => {
    const next = efforts[index]
    if (next !== undefined && index !== committed) onChange(next)
  }
}

/** 外壳的 class。收起比展开快一档——关掉一个东西不需要被欣赏。 */
function effortClass(open: boolean, closing: boolean, costly: boolean): string {
  return [
    "effort",
    open && !closing ? "effort--open" : "",
    closing ? "effort--closing" : "",
    costly ? "effort--costly" : "",
  ]
    .filter(Boolean)
    .join(" ")
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
  const [closing, setClosing] = useState(false)
  const trig = useRef<HTMLButtonElement>(null)
  const efforts = current.efforts ?? []
  const value = effort ?? current.defaultEffort ?? efforts[0]
  // 不在清单里的旧值（换过模型）按 0 档画位置、但标签照原文显示——不编一个档位
  const committed = Math.max(0, efforts.indexOf(value ?? ""))
  // 深空处理只落在最贵的那一档（kimi 的 ultra、claude 的 max / ultracode）——
  // 顶档只是 high 的模型永远没有，见 ModelPicker 的 costlyOf
  const costly = costlyOf([current], current.id, effort)

  /** 收起走 190ms 的收回动画，条子退场、触发器才回来。 */
  const close = (refocus: boolean): void => {
    setClosing(true)
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
      // 触发器要等收起重渲染之后才在
      if (refocus) {
        requestAnimationFrame(() => {
          trig.current?.focus()
        })
      }
    }, 190)
  }

  if (efforts.length === 0) return null
  return (
    <span className="effortbox">
      {/* 「更快消耗使用额度」那句话。**不常驻**——上一版它常驻浮在触发器正上方，
          而那块地正是正文的最后一行：打满字就直接压在字上。
          现在它是停一下（或键盘聚焦）才出来的一张带底的小卡，
          常驻那句话交给坡道色的刻度和档位名（见 `.effort__warn`）。 */}
      {costly && !open ? <span className="effort__warn">更快消耗使用额度</span> : null}
      <span
        className={effortClass(open, closing, costly)}
        style={{ "--effort-w": `${String(barWidth(efforts.length))}px` } as React.CSSProperties}
      >
        {open ? (
          <EffortBar
            efforts={efforts}
            committed={committed}
            costly={costly}
            onCommit={committer(efforts, committed, onChange)}
            onClose={close}
          />
        ) : (
          <EffortTrigger
            count={efforts.length}
            index={committed}
            costly={costly}
            label={value === undefined ? "默认" : effortLabel(value).label}
            disabled={disabled}
            trig={trig}
            onOpen={() => {
              setOpen(true)
            }}
          />
        )}
      </span>
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
