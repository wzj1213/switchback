import { useEffect, useRef } from "react"
import { splitPath } from "../diff.js"
import { useMessages } from "../i18n.js"
import { MENTION_LIST } from "./MentionList.messages.js"

/**
 * `@` 文件引用的候选列表。
 *
 * 悬在输入框**上方**而不是下方：输入框已经贴着窗口底边了，
 * 往下弹的话列表会被裁掉。
 */
export function MentionList({
  cwd,
  paths,
  active,
  open,
  loading,
  failed,
  onPick,
  onRetry,
}: {
  cwd: string
  paths: readonly string[]
  active: number
  open: boolean
  loading: boolean
  failed: boolean
  onPick: (path: string) => void
  onRetry: () => void
}): React.JSX.Element | null {
  const m = useMessages(MENTION_LIST)
  const box = useRef<HTMLDivElement>(null)

  // 键盘上下移动时把选中项滚进视野——不然按到第八条就看不见自己在哪了
  useEffect(() => {
    box.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (!open) return null
  if (paths.length === 0) {
    return <MentionStatus cwd={cwd} loading={loading} failed={failed} onRetry={onRetry} />
  }
  return (
    <div className="mentions">
      <MentionScope cwd={cwd} />
      <div ref={box} role="listbox" aria-label={m.files(cwd)}>
        {paths.map((path, i) => {
          const { dir, name } = splitPath(path)
          return (
            <button
              key={path}
              type="button"
              role="option"
              tabIndex={i === active ? 0 : -1}
              aria-selected={i === active}
              data-active={i === active}
              className={`mentions__row${i === active ? " mentions__row--active" : ""}`}
              // 用 mousedown 而不是 click：click 之前输入框会先失焦，
              // 失焦会把列表关掉，于是这一下点了个空
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(path)
              }}
            >
              <span className="mentions__name">{name}</span>
              <span className="mentions__dir">{dir}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MentionScope({ cwd }: { cwd: string }): React.JSX.Element {
  const m = useMessages(MENTION_LIST)
  return (
    <div className="mentions__scope">
      <span>{m.scope}</span>
      <bdi title={cwd}>{cwd}</bdi>
    </div>
  )
}

export function MentionStatus({ cwd, loading, failed, onRetry }: {
  cwd: string
  loading: boolean
  failed: boolean
  onRetry: () => void
}): React.JSX.Element {
  const m = useMessages(MENTION_LIST)
  const state = loading
    ? <div className="mentions__status" role="status">{m.searching}</div>
    : !failed
      ? <div className="mentions__status" role="status">{m.none}</div>
      : (
        <div className="mentions__status" role="alert">
          <span>{m.failed}</span>
          <button type="button" className="mentions__retry" onMouseDown={(event) => {
            event.preventDefault()
          }} onClick={onRetry}>{m.retry}</button>
        </div>
      )
  return (
    <div className="mentions">
      <MentionScope cwd={cwd} />
      {state}
    </div>
  )
}
