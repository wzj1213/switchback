import { useState } from "react"
import { Prompt } from "./Prompt.js"
import { ModelPicker } from "./ModelPicker.js"
import type { EngineId, EngineInfo, ModelOption, Trust } from "@omni/protocol"

const TRUSTS: readonly { id: Trust; label: string }[] = [
  { id: "read-only", label: "只读" },
  { id: "auto-edit", label: "自动编辑" },
  { id: "full", label: "完全访问" },
]

interface Props {
  /** 回放出来的历史会话：背后没有引擎，只能读不能发。 */
  detached?: boolean
  engine: EngineId
  /** 可选引擎。**由宿主给**，不在这里写死——写死的那份迟早和真正注册了的对不上。 */
  engines: readonly EngineInfo[]
  trust: Trust
  /** 可选模型。空数组时不显示选择器——没得选就别摆一个空下拉。 */
  models: readonly ModelOption[]
  /** 当前模型；undefined 表示用引擎自己的默认 */
  model: string | undefined
  effort: string | undefined
  onModelChange: (model: string, effort?: string) => void
  /** 工作区绝对路径，`@` 文件引用要用 */
  cwd: string
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
}

export function Composer({
  detached = false,
  engine,
  engines,
  trust,
  onEngineChange,
  onTrustChange,
  onSend,
  onResume,
  models,
  model,
  effort,
  onModelChange,
  cwd,
  searchFiles,
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
        <Prompt
          value={text}
          detached={detached}
          cwd={cwd}
          searchFiles={searchFiles}
          onChange={setText}
          onSubmit={submit}
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
            {engines.map((item) => (
              // 没装的**仍然可选**，只加个记号：探测也会错，硬拦住一个其实能用的
              // 引擎比不检查更糟。选中之后真起不来，横幅会说清楚原因
              <option key={item.id} value={item.id} title={item.detail ?? ""}>
                {item.state === "missing" ? `${item.label}（未安装）` : item.label}
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

/** 引擎/档位 id → 展示名。顶栏、导出、菜单都要用同一套措辞。 */
export function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id
}

export { TRUSTS }
