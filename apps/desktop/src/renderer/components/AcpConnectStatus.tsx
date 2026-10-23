import type { RegistryRow } from "../../shared/acp-registry.js"
import { planText, sizeOf } from "../acp-registry-view.js"
import { stepText, type useAcpConnect } from "../use-acp.js"
import { TrialLine } from "./AcpLogin.js"
import { useLocale } from "../i18n.js"
import { ACP_STATUS } from "./AcpConnectStatus.messages.js"

/**
 * 接入 / 升级走到哪一步：确认 → 进行中 → 结果。注册表那一行与已接那张卡共用。
 *
 * **确认这一步不能省**：点下去之后 Switchback 会执行一条命令、或者从网上下载一个可执行文件——
 * 那一行字必须先摆在人眼前，和真正会执行的一字不差（`planText` 从同一份计划算出来）。
 */
export function ConnectStatus({ row, connect, verb }: {
  row: RegistryRow
  connect: ReturnType<typeof useAcpConnect>
  verb: "connect" | "upgrade"
}): React.JSX.Element | null {
  const { state } = connect
  const locale = useLocale()
  const m = ACP_STATUS[locale]
  if (state.phase === "idle") return null
  if (state.phase === "confirm") return <Confirm row={row} connect={connect} verb={verb} />
  if (state.phase === "running") {
    return (
      <p className="acp-flow acp-flow--busy" role="status">
        {stepText(state.step, sizeOf, locale)}
        <button type="button" className="tbtn" onClick={connect.cancel}>{m.cancel}</button>
      </p>
    )
  }
  const { result } = state
  if (!result.ok) {
    return (
      <div className="acp-flow">
        <p className="acp-flow__error" role="alert">{result.error ?? m.failed(m.verb[verb])}</p>
        {result.stderr === undefined ? null : <pre className="set__log">{result.stderr.slice(-1200)}</pre>}
        <div className="acp-flow__actions">
          <button type="button" className="tbtn" onClick={connect.start}>{m.retry}</button>
          <button type="button" className="tbtn" onClick={connect.back}>{m.close}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="acp-flow">
      <p className="acp-flow__ok" role="status">
        {verb === "upgrade" ? m.upgraded(row.version) : m.connected(row.name)}
        {result.pending === true ? m.pending : ""}
      </p>
      {result.trial === undefined || result.name === undefined ? null : <TrialLine name={result.name} trial={result.trial} />}
    </div>
  )
}

function Confirm({ row, connect, verb }: {
  row: RegistryRow
  connect: ReturnType<typeof useAcpConnect>
  verb: "connect" | "upgrade"
}): React.JSX.Element {
  const locale = useLocale()
  const m = ACP_STATUS[locale]
  if (row.plan === undefined) {
    return <p className="acp-flow__error">{row.missing ?? m.cantRun}</p>
  }
  const text = planText(row.plan, locale)
  const facts = [row.license === undefined ? undefined : m.license(row.license), row.authors.length === 0 ? undefined : m.join(row.authors)]
    .filter((fact): fact is string => fact !== undefined)
  return (
    <div className="acp-flow">
      <p className="acp-flow__what">{m.will(text.what)}</p>
      <p className="acp-flow__note">
        {m.confirmNote(text.note)}
        {facts.length === 0 ? "" : m.facts(facts)}
      </p>
      <div className="acp-flow__actions">
        <button type="button" className="tbtn tbtn--on" onClick={connect.start}>{m.confirm(m.verb[verb])}</button>
        <button type="button" className="tbtn" onClick={connect.back}>{m.cancel}</button>
      </div>
    </div>
  )
}
