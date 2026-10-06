import { useMemo } from "react"
import type { EngineDoor } from "../../main/enginedoors.js"
import { bridge, useAsync } from "../use-async.js"
import { PencilIcon } from "./icons-activity.js"
import { RevealIcon } from "./icons.js"
import { Blank } from "./SettingsBits.js"

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

  if (state.failed) return <Blank tone="error">没能读取原生配置来源；可以稍后重开设置再试。</Blank>
  if (state.data === undefined) return <Blank>正在确认配置来源…</Blank>
  const rows = state.data.filter((door) => door.id === engine)
  if (rows.length === 0) {
    return <Blank>这家由 engines.json 接入；Switchback 不知道它自己的配置放在哪里。</Blank>
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
          {door.exists ? "已存在" : "尚未创建"}
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
