import { useState } from "react"
import { Prompt } from "./Prompt.js"
import { ModelPicker } from "./ModelPicker.js"
import { Select } from "./Select.js"
import { EngineIcon, ShieldIcon } from "./icons.js"
import type { EngineId, EngineInfo, ModelOption, Trust } from "@omni/protocol"

/**
 * 信任档。
 *
 * `hint` 不是可有可无的：这三个词说得出**档位叫什么**，说不出
 * **它到底会不会问我**。而这正是用户在改这个控件时唯一关心的事。
 */
const TRUSTS: readonly { id: Trust; label: string; hint: string }[] = [
  { id: "read-only", label: "只读", hint: "任何写入与命令都拒绝" },
  { id: "auto-edit", label: "自动编辑", hint: "工作区内的改动直接放行，越界才问" },
  { id: "full", label: "完全访问", hint: "只在红线上问（工作区外、网络、不可逆操作）" },
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
          <Select
            label={labelOf(engines, engine)}
            icon={<EngineIcon />}
            title="引擎"
            disabled={detached}
            sections={[
              {
                value: engine,
                onPick: onEngineChange,
                // 探测出「没装」的**仍然可选**，只在右边加个记号：探测也会错，
                // 硬拦住一个其实能用的引擎比不检查更糟。真起不来时横幅会说原因
                choices: engines.map((item) => ({
                  id: item.id,
                  label: item.label,
                  ...(item.state === "missing" ? { note: "未安装" } : {}),
                  ...(item.detail === undefined ? {} : { description: item.detail }),
                })),
              },
            ]}
          />
          <Select
            label={labelOf(TRUSTS, trust)}
            icon={<ShieldIcon />}
            title="信任档"
            disabled={detached}
            sections={[
              {
                value: trust,
                onPick: (id) => {
                  onTrustChange(id as Trust)
                },
                choices: TRUSTS.map((item) => ({ id: item.id, label: item.label, description: item.hint })),
              },
            ]}
          />
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
