import { useState } from "react"
import type { EngineId, Trust } from "@omni/protocol"

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
  engine: EngineId
  trust: Trust
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string) => void
}

export function Composer({ engine, trust, onEngineChange, onTrustChange, onSend }: Props): React.JSX.Element {
  const [text, setText] = useState("")
  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed === "") return
    onSend(trimmed)
    setText("")
  }

  return (
    <div className="composer">
      <div className="composer__inner">
        <textarea
          className="composer__input"
          placeholder="交代任务…"
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
          <span style={{ flex: 1 }} />
          <button className="btn btn--primary" type="button" onClick={submit}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

export { ENGINES, TRUSTS }
