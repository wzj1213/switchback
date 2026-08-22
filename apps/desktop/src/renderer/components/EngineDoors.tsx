import { useEffect, useState } from "react"
import type { EngineDoor } from "../../main/enginedoors.js"
import { PencilIcon } from "./icons-activity.js"
import { RevealIcon } from "./icons.js"

interface DoorState {
  list?: readonly EngineDoor[]
  failed: boolean
}

/**
 * 一家引擎实际会读的原生配置来源。
 *
 * 这里把“哪一层、有没有、管什么”直接画出来；能安全打开的现有文件可一键交给系统编辑器。
 * 字段本身仍不由 omni 改写：厂商没有稳定写接口时，伪造表单只会把旧格式包装得更像真的。
 */
export function EngineDoors({
  engine,
  cwd,
  onReveal,
}: {
  engine: string
  cwd: string | undefined
  onReveal: (path: string) => void
}): React.JSX.Element {
  const [state, setState] = useState<DoorState>({ failed: false })
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    let live = true
    setState({ failed: false })
    void bridge
      ?.engineDoors(cwd)
      .then((list) => {
        if (live) setState({ list, failed: false })
      })
      .catch(() => {
        if (live) setState({ list: [], failed: true })
      })
    return () => {
      live = false
    }
  }, [bridge, cwd])

  if (state.list === undefined) return <p className="doors__wait">正在确认配置来源…</p>
  if (state.failed) {
    return (
      <p className="set__blank set__blank--error" role="alert">
        没能读取原生配置来源；可以稍后重开设置再试。
      </p>
    )
  }
  const rows = state.list.filter((door) => door.id === engine)
  if (rows.length === 0) {
    return <p className="set__blank">这家由 engines.json 接入；omni 不知道它自己的配置放在哪里。</p>
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
  const editable = door.exists && door.scope !== "managed"
  return (
    <div className={`doors__row${door.exists ? "" : " doors__row--none"}`}>
      <div className="doors__top">
        <span className={`doors__scope doors__scope--${door.scope}`}>{SCOPE[door.scope]}</span>
        <span className={`doors__state doors__state--${door.exists ? "ready" : "missing"}`}>
          {door.exists ? "已生效" : "尚未创建"}
        </span>
        <span className="doors__note">{door.note}</span>
        <span className="doors__actions">
          {editable ? (
            <button
              type="button"
              className="tbtn"
              onClick={() => {
                window.omni?.openEngineFile(door.path)
              }}
            >
              <PencilIcon /> 编辑
            </button>
          ) : null}
          {door.exists ? (
            <button
              type="button"
              className="tbtn"
              aria-label={`在访达中显示 ${door.path}`}
              title="在访达中显示"
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

const SCOPE: Readonly<Record<EngineDoor["scope"], string>> = {
  user: "用户级",
  project: "项目级",
  managed: "厂商维护",
}
