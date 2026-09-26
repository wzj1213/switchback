import { useState } from "react"
import type { RegistryRow, RegistryView } from "../../shared/acp-registry.js"
import { ageOf, builtinTwin, filterRows } from "../acp-registry-view.js"
import { useAcpConnect } from "../use-acp.js"
import { ConnectStatus } from "./AcpConnectStatus.js"
import { ExternalLink } from "./external-link.js"

/**
 * ACP 官方注册表里的各家：筛一筛、点「接入」。
 *
 * 清单是注册表的原样——名字、描述、作者、许可都是各家自己登记的（多是英文），
 * omni 不翻译、不排推荐位；按名字字母序排，和注册表网页一致。
 */
export function AcpRegistry({ view, loading, failed, onRefresh, onChanged }: {
  view: RegistryView | undefined
  loading: boolean
  failed: boolean
  onRefresh: () => void
  onChanged: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const rows = filterRows(view?.rows ?? [], query)
  const status = statusOf(view, loading)
  return (
    <div className="acp-reg">
      <div className="acp-reg__bar">
        <input
          className="set__input acp-reg__search"
          type="search"
          value={query}
          placeholder="按名字、作者或描述筛选"
          aria-label="筛选注册表"
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
        <span className="acp-reg__age">{status}</span>
        <button type="button" className="tbtn" disabled={loading} onClick={onRefresh} title="不管本机那份新不新，现在就从网上取一次">
          {loading ? "取中…" : "刷新"}
        </button>
      </div>
      {view?.error === undefined ? null : <p className="acp-reg__error" role="alert">{view.error}</p>}
      {failed && view === undefined ? <p className="acp-reg__error" role="alert">读不到注册表。</p> : null}
      <ul className="acp-reg__list">
        {rows.map((row) => (
          <AcpRegistryRow key={row.id} row={row} onChanged={onChanged} />
        ))}
      </ul>
      {view !== undefined && view.rows.length > 0 && rows.length === 0 ? (
        <p className="acp-reg__empty">没有匹配「{query}」的。</p>
      ) : null}
    </div>
  )
}

function statusOf(view: RegistryView | undefined, loading: boolean): string {
  if (view === undefined) return loading ? "正在取注册表…" : ""
  return `${String(view.rows.length)} 家 · ${ageOf(view.fetchedAt, Date.now())}`
}

function AcpRegistryRow({ row, onChanged }: { row: RegistryRow; onChanged: () => void }): React.JSX.Element {
  const connect = useAcpConnect(row.id, onChanged)
  const open = connect.state.phase !== "idle"
  // **动词在点下去那一刻定**：接完之后清单会重读，这一行随即变成「已接入」——
  // 那时再现算，第一次接入的结果会被写成「已升级」
  const [verb, setVerb] = useState<"接入" | "升级">("接入")
  const ask = (): void => {
    setVerb(row.connected === undefined ? "接入" : "升级")
    connect.ask()
  }
  return (
    <li className={`acp-row${open ? " acp-row--open" : ""}`}>
      <div className="acp-row__top">
        <span className="acp-row__name">{row.name}</span>
        <span className="acp-row__ver">v{row.version}</span>
        {row.plan === undefined ? null : <span className="acp-row__kind">{row.plan.kind}</span>}
        <Twin id={row.id} />
        <span className="acp-row__desc" title={row.description}>{row.description ?? ""}</span>
        <RowAction row={row} idle={!open} onAsk={ask} />
      </div>
      {open ? (
        <>
          <ConnectStatus row={row} connect={connect} verb={verb} />
          {connect.state.phase === "confirm" && (row.repository ?? row.website) !== undefined ? (
            <p className="acp-row__links">
              <ExternalLink href={row.repository ?? row.website}>{row.repository ?? row.website}</ExternalLink>
            </p>
          ) : null}
        </>
      ) : null}
    </li>
  )
}

/** omni 已经内置了原生入口的那几家：标一下，不拦。 */
function Twin({ id }: { id: string }): React.JSX.Element | null {
  const builtin = builtinTwin(id)
  if (builtin === undefined) return null
  return (
    <span className="acp-row__twin" title={`omni 已内置 ${builtin}，走它自己的原生入口；这一条是它的 ACP 版本，接了会在引擎下拉里另占一项`}>
      已内置
    </span>
  )
}

/** 行尾那一格：接入 / 升级 / 已接入 / 起不了。流程展开时让位给下面那块。 */
function RowAction({ row, idle, onAsk }: { row: RegistryRow; idle: boolean; onAsk: () => void }): React.JSX.Element | null {
  if (!idle) return null
  if (row.connected !== undefined && !row.connected.update) {
    return <span className="acp-row__done" title={`engines.json 里的 ${row.connected.name}`}>已接入</span>
  }
  if (row.plan === undefined) return <span className="acp-row__missing" title={row.missing}>起不了</span>
  return (
    <button type="button" className="tbtn" onClick={onAsk}>
      {row.connected === undefined ? "接入" : `升级到 v${row.version}`}
    </button>
  )
}
