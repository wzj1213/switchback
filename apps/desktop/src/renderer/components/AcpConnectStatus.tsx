import type { RegistryRow } from "../../shared/acp-registry.js"
import { planText, sizeOf } from "../acp-registry-view.js"
import { stepText, type useAcpConnect } from "../use-acp.js"
import { TrialLine } from "./AcpLogin.js"

/**
 * 接入 / 升级走到哪一步：确认 → 进行中 → 结果。注册表那一行与已接那张卡共用。
 *
 * **确认这一步不能省**：点下去之后 omni 会执行一条命令、或者从网上下载一个可执行文件——
 * 那一行字必须先摆在人眼前，和真正会执行的一字不差（`planText` 从同一份计划算出来）。
 */
export function ConnectStatus({ row, connect, verb }: {
  row: RegistryRow
  connect: ReturnType<typeof useAcpConnect>
  verb: "接入" | "升级"
}): React.JSX.Element | null {
  const { state } = connect
  if (state.phase === "idle") return null
  if (state.phase === "confirm") return <Confirm row={row} connect={connect} verb={verb} />
  if (state.phase === "running") {
    return (
      <p className="acp-flow acp-flow--busy" role="status">
        {stepText(state.step, sizeOf)}
        <button type="button" className="tbtn" onClick={connect.cancel}>取消</button>
      </p>
    )
  }
  const { result } = state
  if (!result.ok) {
    return (
      <div className="acp-flow">
        <p className="acp-flow__error" role="alert">{result.error ?? `${verb}失败。`}</p>
        {result.stderr === undefined ? null : <pre className="set__log">{result.stderr.slice(-1200)}</pre>}
        <div className="acp-flow__actions">
          <button type="button" className="tbtn" onClick={connect.start}>再试一次</button>
          <button type="button" className="tbtn" onClick={connect.back}>收起</button>
        </div>
      </div>
    )
  }
  return (
    <div className="acp-flow">
      <p className="acp-flow__ok" role="status">
        {verb === "升级" ? `已升级到 v${row.version}。` : `已接入，现在就能在引擎下拉里选「${row.name}」。`}
        {result.pending === true ? "有会话正在用旧版本，它们关掉之后才换上新的。" : ""}
      </p>
      {result.trial === undefined || result.name === undefined ? null : <TrialLine name={result.name} trial={result.trial} />}
    </div>
  )
}

function Confirm({ row, connect, verb }: {
  row: RegistryRow
  connect: ReturnType<typeof useAcpConnect>
  verb: "接入" | "升级"
}): React.JSX.Element {
  if (row.plan === undefined) {
    return <p className="acp-flow__error">{row.missing ?? "这台机器上起不了它。"}</p>
  }
  const text = planText(row.plan)
  const facts = [row.license === undefined ? undefined : `许可 ${row.license}`, row.authors.length === 0 ? undefined : row.authors.join("、")]
    .filter((fact): fact is string => fact !== undefined)
  return (
    <div className="acp-flow">
      <p className="acp-flow__what">将{text.what}</p>
      <p className="acp-flow__note">
        {text.note}接之前先握手试接，答不上来就不写进 engines.json。
        {facts.length === 0 ? "" : `（${facts.join(" · ")}）`}
      </p>
      <div className="acp-flow__actions">
        <button type="button" className="tbtn tbtn--on" onClick={connect.start}>确认{verb}</button>
        <button type="button" className="tbtn" onClick={connect.back}>取消</button>
      </div>
    </div>
  )
}
