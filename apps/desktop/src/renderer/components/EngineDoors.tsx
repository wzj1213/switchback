import { useMemo } from "react"
import type { EngineDoor } from "../../main/enginedoors.js"
import { bridge, useAsync } from "../use-async.js"
import { PencilIcon } from "./icons-activity.js"
import { RevealIcon } from "./icons.js"
import { Blank } from "./SettingsBits.js"
import { useMessages } from "../i18n.js"
import { ENGINE_DOORS } from "./EngineDoors.messages.js"

/**
 * 一家引擎实际会读的原生配置来源。
 *
 * 这里把「哪一层、有没有、管什么」直接画出来；能安全打开的现有文件可一键交给系统编辑器。
 * 字段本身仍不由 Switchback 改写：厂商没有稳定写接口时，伪造表单只会把旧格式包装得更像真的。
 */
export function EngineDoors({
  engine,
  cwd,
  dshProfile,
  onReveal,
}: {
  engine: string
  cwd: string | undefined
  dshProfile?: string
  onReveal: (path: string) => void
}): React.JSX.Element {
  const switchback = bridge()
  const load = useMemo(
    () => (switchback === undefined ? undefined : () => switchback.engineDoors(cwd, dshProfile)),
    [switchback, cwd, dshProfile],
  )
  const state = useAsync<readonly EngineDoor[]>(load)
  const m = useMessages(ENGINE_DOORS)

  if (state.failed) return <Blank tone="error">{m.failed}</Blank>
  if (state.data === undefined) return <Blank>{m.loading}</Blank>
  const rows = state.data.filter((door) => door.id === engine)
  if (rows.length === 0) {
    return <Blank>{m.registry}</Blank>
  }
  return (
    <div className="doors">
      {rows.map((door) => (
        <DoorRow key={`${door.scope}:${door.path}`} door={door} onReveal={onReveal} />
      ))}
    </div>
  )
}

function DoorRow({
  door,
  onReveal,
}: {
  door: EngineDoor
  onReveal: (path: string) => void
}): React.JSX.Element {
  const m = useMessages(ENGINE_DOORS)
  const editable = door.exists && door.scope !== "managed"
  return (
    <div className={`doors__row${door.exists ? "" : " doors__row--none"}`}>
      <div className="doors__top">
        <span className={`doors__scope doors__scope--${door.scope}`}>{m.scope[door.scope]}</span>
        <span className={`doors__state doors__state--${door.exists ? "ready" : "missing"}`}>
          {door.exists ? m.exists : m.missing}
        </span>
        <span className="doors__note">{door.note}</span>
        <span className="doors__actions">
          {editable ? (
            <button
              type="button"
              className="tbtn"
              onClick={() => {
                window.switchback?.openEngineFile(door.path)
              }}
            >
              <PencilIcon /> {m.edit}
            </button>
          ) : null}
          {door.exists ? (
            <button
              type="button"
              className="tbtn"
              aria-label={m.revealPath(door.path)}
              title={m.reveal}
              onClick={() => {
                onReveal(door.path)
              }}
            >
              <RevealIcon size={13} />
            </button>
          ) : null}
        </span>
      </div>
      <span className="doors__path" title={door.path}>
        {door.path}
      </span>
    </div>
  )
}

