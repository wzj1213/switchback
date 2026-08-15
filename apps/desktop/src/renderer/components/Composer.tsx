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
  /** 回放出来的历史会话：背后没有引擎，只能读不能发。 */
  detached?: boolean
  engine: EngineId
  trust: Trust
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string) => void
}

export function Composer({
  detached = false,
  engine,
  trust,
  onEngineChange,
  onTrustChange,
  onSend,
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
          placeholder={
            detached ? "这是重启前的历史记录，引擎那边已经没有这段对话的记忆——请新建会话继续。" : "交代任务…"
          }
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
