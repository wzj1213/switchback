import { useState } from "react"
import type { EngineId, ModelOption, Trust } from "@omni/protocol"

const ENGINES: readonly { id: EngineId; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "acp:zcode", label: "ZCode" },
  { id: "acp:kimi", label: "Kimi" },
]

const TRUSTS: readonly { id: Trust; label: string }[] = [
  { id: "read-only", label: "只读" },
  { id: "auto-edit", label: "自动编辑" },
  { id: "full", label: "完全访问" },
]

interface Props {
  /** 回放出来的历史会话：背后没有引擎，只能读不能发。 */
  detached?: boolean
  engine: EngineId
  trust: Trust
  /** 可选模型。空数组时不显示选择器——没得选就别摆一个空下拉。 */
  models: readonly ModelOption[]
  /** 当前模型；undefined 表示用引擎自己的默认 */
  model: string | undefined
  effort: string | undefined
  onModelChange: (model: string, effort?: string) => void
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
}

export function Composer({
  detached = false,
  engine,
  trust,
  onEngineChange,
  onTrustChange,
  onSend,
  onResume,
  models,
  model,
  effort,
  onModelChange,
}: Props): React.JSX.Element {
  const [text, setText] = useState("")
  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed === "" || detached) return
    onSend(trimmed)
    setText("")
  }

  return (
    <div className="composer">
      <div className="composer__inner">
        <textarea
          className="composer__input"
          disabled={detached}
          // 输入框直接说清为什么用不了。留一个能打字却答非所问的框，
          // 比把它关掉糟得多
          placeholder={detached ? "这是重启前的历史记录。点右侧「继续」把引擎接回来。" : "交代任务…"}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
          }}
          onKeyDown={(e) => {
            // Enter 发送，Shift+Enter 换行；IME 组字期间不拦（否则中文输入会被吞）
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer__bar">
          <select
            className="select"
            disabled={detached}
            value={engine}
            onChange={(e) => {
              onEngineChange(e.target.value)
            }}
          >
            {ENGINES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            disabled={detached}
            value={trust}
            onChange={(e) => {
              onTrustChange(e.target.value as Trust)
            }}
          >
            {TRUSTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <ModelPicker
            models={models}
            model={model}
            effort={effort}
            disabled={detached}
            onChange={onModelChange}
          />
          <span style={{ flex: 1 }} />
          {detached ? (
            <button className="btn btn--primary" type="button" onClick={onResume}>
              继续这个会话
            </button>
          ) : (
            <button className="btn btn--primary" type="button" onClick={submit}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

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
function ModelPicker({
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

/** 引擎/档位 id → 展示名。顶栏、导出、菜单都要用同一套措辞。 */
export function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id
}

export { ENGINES, TRUSTS }
