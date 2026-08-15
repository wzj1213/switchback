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
      choices: efforts.map((e) => ({ id: e, label: e })),
    },
  ]
}

export function ModelPicker({
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
  onChange: (model: string, effort?: string) => void
}): React.JSX.Element | null {
  const current = models.find((m) => m.id === model) ?? models[0]
  if (current === undefined) return null
  const level = effort ?? current.defaultEffort
  // 触发器上把两样都写出来：只写模型的话，改了强度之后界面上没有任何变化
  const label = level === undefined ? current.label : `${current.label} · ${level}`
  return (
    <Select
      label={label}
      icon={<SparkIcon />}
      title={current.description ?? "模型与推理强度"}
      disabled={disabled}
      sections={sectionsOf(models, current, level, onChange)}
    />
  )
}
