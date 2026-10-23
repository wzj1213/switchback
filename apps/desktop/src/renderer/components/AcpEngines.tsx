import { useCallback, useMemo, useRef, useState } from "react"
import type { AcpEngineRow, RegistryView } from "../../shared/acp-registry.js"
import { updateOf } from "../acp-registry-view.js"
import { bridge, useAsync, type Async } from "../use-async.js"
import { AcpEngineCard } from "./AcpEngineCard.js"
import { useMessages } from "../i18n.js"
import { ACP_ENGINES } from "./AcpEngines.messages.js"

/**
 * 已经写进 engines.json 的第三方 ACP 引擎，一家一张卡。
 *
 * 和注册表那块共用一个「改过了」的计数：从注册表接一家、升级、移除之后两边一起重读，
 * 否则注册表那行还写着「接入」，而这里已经多了一张卡。
 */
export function AcpEngines({ engines, registry, onChanged }: {
  engines: Async<readonly AcpEngineRow[]>
  registry: RegistryView | undefined
  onChanged: () => void
}): React.JSX.Element {
  const m = useMessages(ACP_ENGINES)
  const list = engines.data ?? []
  if (engines.data === undefined) {
    return <p className="set__blank">{engines.failed ? m.unreadable : m.reading}</p>
  }
  if (list.length === 0) {
    return <p className="set__blank">{m.none}</p>
  }
  return (
    <div className="acp-cards">
      {list.map((engine) => {
        const version = updateOf(engine, registry)
        const row = version === undefined ? undefined : registry?.rows.find((one) => one.id === engine.source?.id)
        return <AcpEngineCard key={engine.name} engine={engine} {...(row === undefined ? {} : { update: row })} onChanged={onChanged} />
      })}
    </div>
  )
}

/**
 * 这一页 ACP 那几块的数据：注册表、已接的几家、以及让它们一起重读的计数。
 *
 * 注册表的「刷新」要强制联网，而「接完一家之后重读」不该——后者只是要本机那份
 * 重新和 engines.json 比一遍。所以强制与否单独记，不借 `useAsync` 的 `again`。
 */
export function useAcpPage(): {
  registry: Async<RegistryView> & { refresh: () => void }
  engines: Async<readonly AcpEngineRow[]>
  changed: () => void
} {
  const switchback = bridge()
  const [revision, setRevision] = useState(0)
  const force = useRef(false)
  const loadRegistry = useMemo(() => {
    if (switchback === undefined) return undefined
    return (): Promise<RegistryView> => {
      const now = force.current
      force.current = false
      return switchback.acpRegistry(now)
    }
    // revision 变了就要一份新的 load，useAsync 才会重读
  }, [switchback, revision])
  const loadEngines = useMemo(() => (switchback === undefined ? undefined : () => switchback.acpEngines()), [switchback, revision])
  const registry = useAsync(loadRegistry)
  const engines = useAsync(loadEngines)
  const { reload } = registry
  const refresh = useCallback(() => {
    force.current = true
    reload()
  }, [reload])
  const changed = useCallback(() => {
    setRevision((n) => n + 1)
  }, [])
  return { registry: { ...registry, refresh }, engines, changed }
}
