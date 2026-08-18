import type { ModelOption } from "@omni/protocol"
import { SparkIcon } from "./icons.js"
import { Select, type Section } from "./Select.js"

/**
 * 模型与推理强度。
 *
 * **一个触发器，面板里分两节。** 上一版是两个原生下拉并排，
 * 而它们说的是同一件事——「这一轮用多强的脑子」。分成两个控件的代价是
 * 输入区那一行摆满了下拉，真正要打字的地方反而显得局促。
 *
 * **没得选就不显示**：引擎还没报清单、或者它根本不支持切换时，
 * 摆一个空下拉只会让人以为坏了。强度同理——只有当前模型报了 `efforts` 才有那一节。
 * ACP 那类把强度编进 modelId 的引擎（`gpt-5.6-sol[low]`）不报 efforts，
 * 于是面板里只有「模型」一节，也就不会出现一个点了没用的控件。
 */
function sectionsOf(
  models: readonly ModelOption[],
  current: ModelOption,
  level: string | undefined,
  onChange: (model: string, effort?: string) => void,
): readonly Section[] {
  const modelSection: Section = {
    title: "模型",
    value: current.id,
    onPick: (id) => {
      // 换模型时把强度重置成新模型的默认：旧模型的 high 在新模型上可能根本不存在
      onChange(id, models.find((m) => m.id === id)?.defaultEffort)
    },
    choices: models.map((m) => ({
      id: m.id,
      label: m.label,
      ...(m.description === undefined ? {} : { description: m.description }),
    })),
  }
  const efforts = current.efforts ?? []
  if (efforts.length === 0) return [modelSection]
  return [
    modelSection,
    {
      title: "推理强度",
      value: level,
      onPick: (id) => {
        onChange(current.id, id)
      },
      choices: efforts.map((e) => ({ id: e, ...effortLabel(e) })),
    },
  ]
}

/**
 * 「恢复默认设置」那一行。
 *
 * **引擎说了算，不是 omni 猜的**：codex 的 `model/list` 里有一条标着 `isDefault`
 *（实测是 gpt-5.6-sol），连同它自己的默认强度一起用。
 * 没有哪条标默认时**不显示这一行**——一个点了不知道会变成什么的按钮，
 * 比没有这个按钮糟。
 *
 * 已经就是默认了也不显示：那一下点了什么都不会发生。
 */
function resetOf(
  models: readonly ModelOption[],
  current: ModelOption,
  level: string | undefined,
  onChange: (model: string, effort?: string) => void,
): { label: string; run: () => void } | undefined {
  const fallback = models.find((m) => m.isDefault === true)
  if (fallback === undefined) return undefined
  if (fallback.id === current.id && level === fallback.defaultEffort) return undefined
  return {
    label: "恢复默认设置",
    run: () => {
      onChange(fallback.id, fallback.defaultEffort)
    },
  }
}

/**
 * 推理强度说人话。
 *
 * 引擎报上来的是 `low` / `medium` / `high` / `xhigh` / `max` / `ultra`——
 * 那是标识符，不是给人读的。codex 自己的面板上写的是「轻度 / 中 / 高 / 极高 / 最高」，
 * 而 omni 一直原样把英文摆出来。
 *
 * **`ultra` 没有跟着 codex 叫「极高」**：它那张表里「极高」出现了两次
 *（一个带「更快消耗使用额度」的注脚）。两个一模一样的选项摆在一起，
 * 靠一行小字区分，是照抄照出来的缺陷，不是要对齐的东西。这里叫「超高」。
 *
 * 认不出的一律原样显示——引擎随时会加档，写死一张表的下场是新档位显示成空白。
 */
const EFFORT: Readonly<Record<string, { label: string; description?: string }>> = {
  low: { label: "轻度" },
  medium: { label: "中" },
  high: { label: "高" },
  xhigh: { label: "极高" },
  max: { label: "最高" },
  ultra: { label: "超高", description: "更快消耗使用额度" },
}

function effortLabel(id: string): { label: string; description?: string } {
  return EFFORT[id] ?? { label: id }
}

export function ModelPicker({
  models,
  model,
  effort,
  disabled,
  pending,
  onChange,
}: {
  models: readonly ModelOption[]
  model: string | undefined
  effort: string | undefined
  disabled: boolean
  /** 有待切换的引擎：它的名字，以及「现在就兑现」那条路。见下面那段。 */
  pending?: { label: string; onSwitchNow: () => void }
  onChange: (model: string, effort?: string) => void
}): React.JSX.Element | null {
  /**
   * **有待切换的引擎时，这颗控件变成一条出路，而不是一句解释。**
   *
   * 手上这份清单是**旧那家**报的，它的模型 id 在新的一家那里通常不存在，
   * 所以确实不能直接让人挑。上上版把整个控件藏起来——一个凭空消失的控件
   * 读起来就是「坏了」；上一版留着但点不动，写着「切到 Grok 后可选」——
   * 而用户明明**已经选了 Grok**，被告知「你还没切」只会更困惑。
   *
   * 现在它是一颗能点的按钮：点一下就把引擎换过去，换完这里显示的是
   * **新那家自己报的**清单，不是我们猜的。
   *
   * 为什么不干脆摆一份「上次记得的」清单让他先挑：那是在猜。模型会下架、
   * 会改名、会因为账号权限而不同，而猜错的代价是「挑好了、切过去发现没有这个模型」。
   */
  if (pending !== undefined) {
    return (
      <button
        type="button"
        className="trigger"
        title={`现在就把引擎换成 ${pending.label}（会重启引擎并交接上下文）。换完就能挑它自己报的模型`}
        disabled={disabled}
        onClick={pending.onSwitchNow}
      >
        <span className="trigger__icon">
          <SparkIcon />
        </span>
        <span className="trigger__label">切到 {pending.label} 再选模型</span>
      </button>
    )
  }
  // 用户选过就用他选的；没选过**优先引擎自己报的当前值**，最后才退回第一个。
  // 直接退回第一个是在撒谎：kimi 报的当前模型是 K3，而列表第一个是 K2.7
  const current = models.find((m) => m.id === model) ?? models.find((m) => m.isDefault === true) ?? models[0]
  if (current === undefined) return null
  const level = effort ?? current.defaultEffort
  // 触发器上把两样都写出来：只写模型的话，改了强度之后界面上没有任何变化
  const label = level === undefined ? current.label : `${current.label} · ${effortLabel(level).label}`
  const reset = resetOf(models, current, level, onChange)
  return (
    <Select
      label={label}
      icon={<SparkIcon />}
      title={current.description ?? "模型与推理强度"}
      disabled={disabled}
      sections={sectionsOf(models, current, level, onChange)}
      {...(reset === undefined ? {} : { reset })}
    />
  )
}
