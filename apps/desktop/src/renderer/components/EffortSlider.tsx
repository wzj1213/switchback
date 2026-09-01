import { useEffect, useRef, useState } from "react"
import type { ModelOption } from "@omni/protocol"
import { currentOf, effortLabel, costlyOf } from "./ModelPicker.js"
import { EffortTrigger } from "./effort-trigger.js"
import { EffortBar } from "./EffortBar.js"
import { barWidth } from "./effort-geometry.js"
import { useReduced } from "../use-reduced.js"
import { useEffortClose } from "./use-effort-close.js"
import { shownEffort, useEffortPending } from "./use-effort-pending.js"

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
  /**
   * 拖动中指着哪一档。**深空那套特效跟着它走，不跟着已落档的值走**——
   * 拖到 ultra 就该当场看见 ultra 的样子，而不是松手才变。
   * 命令仍然只在松手那一下发（见 `EffortBar` 的 `commit`）。
   */
  const [preview, setPreview] = useState<string>()
  const trig = useRef<HTMLButtonElement>(null)
  /**
   * 展开时**把收起态那格宽度冻住**。
   *
   * 条子展开要从 140px 长到两百多，而它住在输入框底下那一行里——不冻的话，
   * 它左边的每一样（模型、审批档、附件…）都会被推着横移六十来像素，
   * 而你的指针正停在刚点下去的那颗上。**点一下不该让别的东西动**。
   * 冻住之后条子改为浮在这一格上（`.effort--open` 的 `position: absolute`），
   * 长出来的那截盖住左边的邻居，一收起就归位。
   */
  const box = useRef<HTMLSpanElement>(null)
  const [slot, setSlot] = useState<number>()
  const reduced = useReduced()
  const efforts = current.efforts ?? []
  /**
   * 现在该画哪一档。三层，从最「当下」往最「确凿」退：
   *
   * 1. `preview`——手指正指着的那一档（只在拖动中有）
   * 2. `pending`——**已经落档、命令发出去了、引擎还没回声**（见 `useEffortPending`）
   * 3. `effort`——引擎确认过的真值
   *
   * 第二层是上一版缺的那一层：它当时住在展开的条子里，条子一收就没了，
   * 于是「拖到 ultracode 马上收起」之后触发器上写的还是旧档位。
   */
  const { pending, mark } = useEffortPending(effort)
  /**
   * **落定的那一档**（不含拖动预览）：`pending` 优先，其次引擎的真值。
   *
   * 它和下面那个 `value` 必须分开，而这正是最容易合掉的一刀：合掉之后
   * 「这一档和现在这档一样吗」会拿**手指指着的那一档**去比——拖动中预览
   * 已经先一步变成目标档，松手时两者相等，于是 `committer` 判成「没变」，
   * **命令一次都发不出去**（改完滑块什么都没发生，实测过一次）。
   */
  const settled = shownEffort({ pending, effort, defaultEffort: current.defaultEffort, efforts })
  const value = preview ?? settled
  // 不在清单里的旧值（换过模型）按 0 档画位置、但标签照原文显示——不编一个档位
  const committed = Math.max(0, efforts.indexOf(value ?? ""))
  const settledIndex = Math.max(0, efforts.indexOf(settled ?? ""))
  // 深空处理只落在最贵的那一档（kimi 的 ultra、claude 的 max / ultracode）——
  // 顶档只是 high 的模型永远没有，见 ModelPicker 的 costlyOf
  const costly = costlyOf([current], current.id, value)

  /**
   * 引擎的回声一到（`effort` 变了）就把预览撤掉，交回给真值；收起时也撤。
   * **不在松手那一下撤**：那时命令刚发出去，`thread.effort` 还是旧的，
   * 中间那一小段会闪一下灰再亮回来。
   */
  useEffect(() => {
    // 连续点两档时，第一档的较早回声不能把第二档的本地反馈清掉。
    setPreview((shown) => (shown === effort ? undefined : shown))
  }, [effort])
  // **收起只撤预览，不撤 `pending`**：预览说的是「手指在哪儿」，收起来手指就不在了；
  // 而 `pending` 说的是「我已经改成这一档了」，那句话在收起之后照样成立
  useEffect(() => {
    if (!open) setPreview(undefined)
  }, [open])
  // 收完（连收回动画一起）才把那格放开：动画期间条子还浮着，位置得钉住
  useEffect(() => {
    if (!open && !closing) setSlot(undefined)
  }, [open, closing])

  /** 收起走 190ms 的收回动画，条子退场、触发器才回来。 */
  const close = useEffortClose({ reduced, trigger: trig, setOpen, setClosing })

  if (efforts.length === 0) return null
  return (
    <span className="effortbox" ref={box} {...(slot === undefined ? {} : { style: { width: slot } })}>
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
            onCommit={committer(efforts, settledIndex, (next) => {
              // 先把乐观档位记下来再发命令：这一行就是「点完立刻变」的全部
              mark(next)
              onChange(next)
            })}
            onPreview={setPreview}
            onClose={close}
            reduced={reduced}
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
              setSlot(box.current?.getBoundingClientRect().width)
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
