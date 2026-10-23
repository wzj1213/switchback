import { useState } from "react"
import type { RegistryRow, RegistryView } from "../../shared/acp-registry.js"
import { ageOf, builtinTwin, filterRows } from "../acp-registry-view.js"
import { useAcpConnect } from "../use-acp.js"
import { ConnectStatus } from "./AcpConnectStatus.js"
import { ExternalLink } from "./external-link.js"
import type { Locale } from "@switchback/i18n"
import { useLocale, useMessages } from "../i18n.js"
import { ACP_REGISTRY } from "./AcpRegistry.messages.js"

/**
 * ACP 官方注册表里的各家：筛一筛、点「接入」。
 *
 * 清单是注册表的原样——名字、描述、作者、许可都是各家自己登记的（多是英文），
 * Switchback 不翻译、不排推荐位；按名字字母序排，和注册表网页一致。
 */
export function AcpRegistry({ view, loading, failed, onRefresh, onChanged }: {
  view: RegistryView | undefined
  loading: boolean
  failed: boolean
  onRefresh: () => void
  onChanged: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const locale = useLocale()
  const m = ACP_REGISTRY[locale]
  const rows = filterRows(view?.rows ?? [], query)
  const fold = useFold(rows, query)
  const status = statusOf(view, loading, locale)
  return (
    <div className="acp-reg">
      <div className="acp-reg__bar">
        <input
          className="set__input acp-reg__search"
          type="search"
          value={query}
          placeholder={m.placeholder}
          aria-label={m.filter}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
        <span className="acp-reg__age">{status}</span>
        <button type="button" className="tbtn" disabled={loading} onClick={onRefresh} title={m.refreshTip}>
          {loading ? m.fetching : m.refresh}
        </button>
      </div>
      {view?.error === undefined ? null : <p className="acp-reg__error" role="alert">{view.error}</p>}
      {failed && view === undefined ? <p className="acp-reg__error" role="alert">{m.unreadable}</p> : null}
      <ul className="acp-reg__list">
        {fold.shown.map((row) => (
          <AcpRegistryRow key={row.id} row={row} onChanged={onChanged} />
        ))}
      </ul>
      {fold.toggle}
      {view !== undefined && view.rows.length > 0 && rows.length === 0 ? (
        <p className="acp-reg__empty">{m.noMatch(query)}</p>
      ) : null}
    </div>
  )
}

/**
 * 不筛选时先摆几家。四十来行一口气铺开，这一页有三屏是注册表，
 * 排在它下面的「手动接入」就再也没人看得见了；要找哪一家，上面那个筛选框比滚动快。
 */
const FIRST = 8

/** 折起来的那几行和「显示全部」那颗开关。有筛选词时不折：那时要的就是全部匹配。 */
function useFold(rows: readonly RegistryRow[], query: string): { shown: readonly RegistryRow[]; toggle: React.ReactNode } {
  const [all, setAll] = useState(false)
  const m = useMessages(ACP_REGISTRY)
  if (query.trim() !== "" || rows.length <= FIRST) return { shown: rows, toggle: null }
  return {
    shown: all ? rows : rows.slice(0, FIRST),
    toggle: (
      <button
        type="button"
        className="acp-reg__more"
        aria-expanded={all}
        onClick={() => {
          setAll((was) => !was)
        }}
      >
        {all ? m.less : m.all(rows.length)}
      </button>
    ),
  }
}

function statusOf(view: RegistryView | undefined, loading: boolean, locale: Locale): string {
  const m = ACP_REGISTRY[locale]
  if (view === undefined) return loading ? m.loading : ""
  return m.status(view.rows.length, ageOf(view.fetchedAt, Date.now(), locale))
}

function AcpRegistryRow({ row, onChanged }: { row: RegistryRow; onChanged: () => void }): React.JSX.Element {
  const connect = useAcpConnect(row.id, onChanged)
  const open = connect.state.phase !== "idle"
  // **动词在点下去那一刻定**：接完之后清单会重读，这一行随即变成「已接入」——
  // 那时再现算，第一次接入的结果会被写成「已升级」
  const [verb, setVerb] = useState<"connect" | "upgrade">("connect")
  const ask = (): void => {
    setVerb(row.connected === undefined ? "connect" : "upgrade")
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

/** Switchback 已经内置了原生入口的那几家：标一下，不拦。 */
function Twin({ id }: { id: string }): React.JSX.Element | null {
  const builtin = builtinTwin(id)
  const m = useMessages(ACP_REGISTRY)
  if (builtin === undefined) return null
  return (
    <span className="acp-row__twin" title={m.twinTip(builtin)}>
      {m.twin}
    </span>
  )
}

/** 行尾那一格：接入 / 升级 / 已接入 / 起不了。流程展开时让位给下面那块。 */
function RowAction({ row, idle, onAsk }: { row: RegistryRow; idle: boolean; onAsk: () => void }): React.JSX.Element | null {
  const m = useMessages(ACP_REGISTRY)
  if (!idle) return null
  if (row.connected !== undefined && !row.connected.update) {
    return <span className="acp-row__done" title={m.connectedTip(row.connected.name)}>{m.connected}</span>
  }
  if (row.plan === undefined) return <span className="acp-row__missing" title={row.missing}>{m.cantRun}</span>
  return (
    <button type="button" className="tbtn" onClick={onAsk}>
      {row.connected === undefined ? m.connect : m.upgradeTo(row.version)}
    </button>
  )
}
