import type { ModelOption } from "@omni/protocol"
import { SparkIcon } from "./icons.js"
import { Select, type Section } from "./Select.js"
import { currentModel } from "../model-options.js"
import { triggerLabel } from "../model-label.js"
import { usePickPending } from "./use-pick-pending.js"

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
  // claude 的顶档模式：不是强度档，是另一个设置键（CLI 滑块最右那档也是这么拼的）
  ultracode: { label: "Ultracode", description: "xhigh ＋ 工作流编排，更快消耗使用额度" },
}

export function effortLabel(id: string): { label: string; description?: string } {
  return EFFORT[id] ?? { label: id }
}

/**
 * 当前模型：用户选过就用他选的；没选过**优先引擎自己报的当前值**，最后才退回第一个。
 * 直接退回第一个是在撒谎：kimi 报的当前模型是 K3，而列表第一个是 K2.7。
 */
export function currentOf(
  models: readonly ModelOption[],
  model: string | undefined,
): ModelOption | undefined {
  return currentModel(models, model)
}

/** 只有原生清单里的 ultra / ultracode 顶档显示更快消耗额度的提示。 */
const COSTLY: ReadonlySet<string> = new Set(["ultra", "ultracode"])

/**
 * 贵档落没落。模型自己报的清单里**最后一档得是开 workflow 的那个模式**
 *（`ultra` / `ultracode`；顶档只是 max / xhigh 的模型永远没有），
 * 当前强度还得正落在那一档上——换模型残留的旧值不算。
 * 触发器上那截强度据此加重。
 */
export function costlyOf(
  models: readonly ModelOption[],
  model: string | undefined,
  effort: string | undefined,
): boolean {
  const current = currentOf(models, model)
  const efforts = current?.efforts ?? []
  const top = efforts[efforts.length - 1]
  if (current === undefined || top === undefined || !COSTLY.has(top)) return false
  return (effort ?? current.defaultEffort) === top
}

/**
 * 触发器上跟在模型名后面的那截强度（`Default · 高`）。
 *
 * 输入区原来另有一条强度滑块，触发器就只写模型——同一个值不在一行里写两遍。
 * 滑块去掉之后强度只在这个菜单里改，于是按钮上得看得出现在是哪一档。
 * 没报 `efforts` 的模型（ACP 那类把强度编进 modelId）没有这一截。
 */
export function triggerDetail(
  models: readonly ModelOption[],
  current: ModelOption,
  level: string | undefined,
): { text: string; strong: boolean } | undefined {
  if ((current.efforts ?? []).length === 0 || level === undefined) return undefined
  return { text: effortLabel(level).label, strong: costlyOf(models, current.id, level) }
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
  // 选完到引擎回声之间那几秒，按钮照刚选的画（见 `use-pick-pending.ts`）
  const { picked, mark } = usePickPending(model, effort)
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
        title={`现在就把原生会话切到 ${pending.label}；不会自动发送内容。换完就能挑它自己报的模型`}
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
  const current = currentOf(models, picked?.model ?? model)
  if (current === undefined) return null
  const level = (picked === undefined ? effort : picked.effort) ?? current.defaultEffort
  const change = (next: string, nextEffort?: string): void => {
    mark({ model: next, ...(nextEffort === undefined ? {} : { effort: nextEffort }) })
    onChange(next, nextEffort)
  }
  // 尾部那对括号只在触发器上裁掉（理由见 `model-label.ts`）；
  // 裁过就把全名挂到悬停上，别让它只能靠打开菜单才找得回来
  const label = triggerLabel(current.label)
  const reset = resetOf(models, current, level, change)
  const detail = triggerDetail(models, current, level)
  return (
    <Select
      label={label}
      {...(detail === undefined ? {} : { detail })}
      title={current.description ?? (label === current.label ? "模型与推理强度" : current.label)}
      disabled={disabled}
      sections={sectionsOf(models, current, level, change)}
      {...(reset === undefined ? {} : { reset })}
    />
  )
}
