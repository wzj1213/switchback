import { useState } from "react"
import type { AcpEngineRow, AcpTrialView, RegistryRow } from "../../shared/acp-registry.js"
import { commandLine } from "../acp-registry-view.js"
import { bridge } from "../use-async.js"
import { TrialLine } from "./AcpLogin.js"
import { ConnectStatus } from "./AcpConnectStatus.js"
import { useAcpConnect } from "../use-acp.js"
import { useMessages } from "../i18n.js"
import { ACP_ENGINE_CARD } from "./AcpEngineCard.messages.js"

/**
 * 已经接进来的一家：它是什么、怎么起的、能不能起、怎么登录、要不要升级或移除。
 *
 * **登录方式要先「试接」才出来**：那是它在握手时现报的，缓存一份只会在它升级后说错话。
 * 试接只握手、不开会话，没有副作用。
 */
export function AcpEngineCard({ engine, update, onChanged }: {
  engine: AcpEngineRow
  /** 注册表里那一行：有新版时才给。 */
  update?: RegistryRow
  onChanged: () => void
}): React.JSX.Element {
  const switchback = bridge()
  const m = useMessages(ACP_ENGINE_CARD)
  const [trial, setTrial] = useState<AcpTrialView | undefined>(undefined)
  const [trying, setTrying] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | undefined>(undefined)
  const probe = (): void => {
    if (switchback === undefined) return
    setTrying(true)
    setTrial(undefined)
    void switchback.acpEngineTry(engine.name).then(setTrial, (error: unknown) => setTrial({ ok: false, error: String(error) })).finally(() => setTrying(false))
  }
  return (
    <div className="acp-card">
      <div className="acp-card__top">
        <span className="acp-card__name">{engine.label}</span>
        <span className="acp-card__meta">
          {engine.source === undefined ? m.manual : m.registry(engine.source.version, engine.source.kind)}
        </span>
        {engine.inUse ? <span className="acp-card__busy" title={m.inUseTip}>{m.inUse}</span> : null}
        <span className="acp-card__actions">
          <button type="button" className="tbtn" disabled={trying} onClick={probe} title={m.tryTip}>
            {trying ? m.trying : m.try}
          </button>
          <Remove engine={engine} onChanged={onChanged} onNote={setNote} />
        </span>
      </div>
      <code className="acp-card__cmd" title={commandLine(engine.command, engine.args)}>{commandLine(engine.command, engine.args)}</code>
      {update === undefined || engine.source === undefined ? null : <Upgrade row={update} onChanged={onChanged} />}
      {trial === undefined ? null : <TrialLine name={engine.name} trial={trial} />}
      {note === undefined ? null : (
        <p className={`acp-card__note${note.error ? " acp-card__note--error" : ""}`} role={note.error ? "alert" : "status"}>{note.text}</p>
      )}
    </div>
  )
}

function Upgrade({ row, onChanged }: { row: RegistryRow; onChanged: () => void }): React.JSX.Element {
  const connect = useAcpConnect(row.id, onChanged)
  const m = useMessages(ACP_ENGINE_CARD)
  if (connect.state.phase === "idle") {
    return (
      <p className="acp-card__note">
        {m.newer(row.version)}
        <button type="button" className="tbtn acp-card__inline" onClick={connect.ask}>{m.upgrade}</button>
      </p>
    )
  }
  return <ConnectStatus row={row} connect={connect} verb="upgrade" />
}

function Remove({ engine, onChanged, onNote }: {
  engine: AcpEngineRow
  onChanged: () => void
  onNote: (note: { text: string; error: boolean }) => void
}): React.JSX.Element {
  const switchback = bridge()
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle")
  const m = useMessages(ACP_ENGINE_CARD)
  if (step === "idle") {
    return <button type="button" className="tbtn" onClick={() => setStep("confirm")}>{m.remove}</button>
  }
  return (
    <button
      type="button"
      className="tbtn tbtn--danger"
      disabled={step === "busy"}
      title={engine.inUse ? m.removeInUse : m.removeTip}
      onBlur={() => setStep((current) => (current === "confirm" ? "idle" : current))}
      onClick={() => {
        setStep("busy")
        void switchback?.acpEngineRemove(engine.name).then((done) => {
          setStep("idle")
          // 删掉了就不必说话——这一行会随列表刷新消失；在用的与失败的才要说
          if (!done.ok) onNote({ text: done.error ?? m.removeFailed, error: true })
          else if (done.pending === true) onNote({ text: m.removePending, error: false })
          onChanged()
        })
      }}
    >
      {m.confirm}
    </button>
  )
}
