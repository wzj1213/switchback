import { useEffect, useRef } from "react"
import { splitPath } from "../diff.js"

/**
 * `@` 文件引用的候选列表。
 *
 * 悬在输入框**上方**而不是下方：输入框已经贴着窗口底边了，
 * 往下弹的话列表会被裁掉。
 */
export function MentionList({
  paths,
  active,
  onPick,
}: {
  paths: readonly string[]
  active: number
  onPick: (path: string) => void
}): React.JSX.Element | null {
  const box = useRef<HTMLDivElement>(null)

  // 键盘上下移动时把选中项滚进视野——不然按到第八条就看不见自己在哪了
  useEffect(() => {
    box.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (paths.length === 0) return null
  return (
    <div className="mentions" ref={box} role="listbox">
      {paths.map((path, i) => {
        const { dir, name } = splitPath(path)
        return (
          <button
            key={path}
            type="button"
            role="option"
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
  )
}
