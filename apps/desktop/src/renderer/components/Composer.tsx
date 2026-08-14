import type { EngineId, Trust } from "@omni/protocol"

const ENGINES: readonly { id: EngineId; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
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
}

export function Composer({ engine, trust, onEngineChange, onTrustChange }: Props): React.JSX.Element {
  return (
    <div className="composer">
      <div className="composer__inner">
        <textarea className="composer__input" placeholder="交代任务…" />
        <div className="composer__bar">
          <select
            className="select"
            value={engine}
            onChange={(e) => {
              onEngineChange(e.target.value)
            }}
          >
            {ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
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
            {TRUSTS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn--primary" type="button">
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

export { ENGINES, TRUSTS }
