import { useCallback, useState } from "react"
import { Popover } from "./Popover.js"

/**
 * 右键菜单。和下拉共用 `Popover`，区别只在于**定位到光标**、条目带图标。
 *
 * ## 为什么不用 Electron 的原生菜单
 *
 * 主进程有 `Menu.popup()`，画出来是真正的系统菜单。放弃它的理由和放弃原生
 * `<select>` 一样，外加一条更要命的：**菜单项是否可用取决于渲染层的状态**
 * （这个会话是不是历史记录、有没有分叉对手、当前选中的是哪个）。
 * 走主进程就要把这些状态同步过去一份，而两份状态迟早对不上——
 * 表现成「菜单里灰着一项，其实它是可用的」。
 *
 * 代价是拿不到系统菜单的原生手感（比如按住不放拖到某一项）。
 * 对一个每天用几次的操作，这个代价可以接受。
 */

export interface Command {
  label: string
  icon?: React.ReactNode
  /** 不可逆的操作标红。**只标不拦**——拦在这里的话用户会去找别的路。 */
  danger?: boolean
  run: () => void
}

export interface MenuState {
  at: { x: number; y: number }
  commands: readonly Command[]
}

/**
 * 挂右键菜单。
 *
 * 返回 `onContextMenu` 和要渲染的元素。做成 hook 而不是组件，是因为
 * **触发点和渲染点不在一处**：右键发生在某一行上，而菜单必须渲染在
 * 那一行的 DOM 之外（否则会被行的 `overflow: hidden` 裁掉）。
 */
export function useContextMenu(): {
  open: (event: React.MouseEvent, commands: readonly Command[]) => void
  menu: React.JSX.Element | null
} {
  const [state, setState] = useState<MenuState | undefined>(undefined)

  const open = useCallback((event: React.MouseEvent, commands: readonly Command[]) => {
    event.preventDefault()
    // 空菜单不弹：一个打开就是空的菜单比没有菜单更让人困惑
    if (commands.length === 0) return
    setState({ at: { x: event.clientX, y: event.clientY }, commands })
  }, [])

  const close = useCallback(() => {
    setState(undefined)
  }, [])

  const menu =
    state === undefined ? null : (
      <Popover open anchor={null} at={state.at} minWidth={170} onClose={close}>
        <div role="menu">
          {state.commands.map((command) => (
            <button
              type="button"
              key={command.label}
              role="menuitem"
              className={`pop__cmd${command.danger === true ? " pop__cmd--danger" : ""}`}
              onClick={() => {
                close()
                command.run()
              }}
            >
              <span className="pop__cmd-icon">{command.icon}</span>
              <span>{command.label}</span>
            </button>
          ))}
        </div>
      </Popover>
    )

  return { open, menu }
}
