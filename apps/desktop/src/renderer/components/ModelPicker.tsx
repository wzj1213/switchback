import type { ModelOption } from "@omni/protocol"

/** 只有当前模型报了 `efforts` 才出现——不支持的引擎上摆一个改了不生效的控件更糟。 */
function EffortPicker({
  efforts,
  value,
  disabled,
  onChange,
}: {
  efforts: readonly string[]
  value: string | undefined
  disabled: boolean
  onChange: (effort: string) => void
}): React.JSX.Element | null {
  if (efforts.length === 0) return null
  return (
    <select
      className="select"
      disabled={disabled}
      value={value ?? efforts[0]}
      title="推理强度"
      onChange={(e) => {
        onChange(e.target.value)
      }}
    >
      {efforts.map((level) => (
        <option key={level} value={level}>
          {level}
        </option>
      ))}
    </select>
  )
}

/**
 * 模型与推理强度。
 *
 * **没得选就不显示**：引擎还没报清单、或者它根本不支持切换时，
 * 摆一个空下拉只会让人以为坏了。强度同理——只有当前模型报了 `efforts` 才出现。
 */
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
  if (models.length === 0) return null
  const current = models.find((m) => m.id === model) ?? models[0]
  const efforts = current?.efforts ?? []
  return (
    <>
      <select
        className="select"
        disabled={disabled}
        value={current?.id ?? ""}
        title={current?.description ?? "模型"}
        onChange={(e) => {
          const next = models.find((m) => m.id === e.target.value)
          // 换模型时把强度重置成新模型的默认：旧模型的 high 在新模型上可能根本不存在
          onChange(e.target.value, next?.defaultEffort)
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <EffortPicker
        efforts={efforts}
        value={effort ?? current?.defaultEffort}
        disabled={disabled}
        onChange={(next) => {
          onChange(current?.id ?? "", next)
        }}
      />
    </>
  )
}
