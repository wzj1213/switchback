import { useCallback, useState } from "react"
import { CloseIcon } from "./icons-panel.js"
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
  /**
   * 这一条右边摆一排可点的小东西（现在只有项目图标在用）。
   *
   * **选一个图标不该再开一层界面。** 二级菜单意味着「点开 → 移过去 →
   * 再点一下」，而这件事本身只值一次点击。
   */
  pick?: readonly { icon: string; run: () => void }[]
}

export interface MenuState {
  at: { x: number; y: number }
  anchor: HTMLElement
  commands: readonly Command[]
  /** 菜单顶上的一小块说明。**只读**，不是菜单项——见 `open` 的注释。 */
  head?: React.ReactNode
}

/**
 * 挂右键菜单。
 *
 * 返回 `onContextMenu` 和要渲染的元素。做成 hook 而不是组件，是因为
 * **触发点和渲染点不在一处**：右键发生在某一行上，而菜单必须渲染在
 * 那一行的 DOM 之外（否则会被行的 `overflow: hidden` 裁掉）。
 */
export function useContextMenu(): {
  /**
   * @param head 菜单顶上那块只读说明（路径、分支、几个会话…）。
   *   命令回答「我能做什么」，而它回答**「我点的到底是哪个东西」**——
   *   侧栏里一行只有一个截断的名字，右键之前经常是不确定的。
   */
  open: (event: React.MouseEvent, commands: readonly Command[], head?: React.ReactNode) => void
  menu: React.JSX.Element | null
} {
  const [state, setState] = useState<MenuState | undefined>(undefined)

  const open = useCallback(
    (event: React.MouseEvent, commands: readonly Command[], head?: React.ReactNode) => {
      event.preventDefault()
      // 空菜单不弹：一个打开就是空的菜单比没有菜单更让人困惑
      if (commands.length === 0) return
      setState({
        at: { x: event.clientX, y: event.clientY },
        anchor:
          event.target instanceof HTMLElement
            ? (event.target.closest<HTMLElement>("button, a[href], [tabindex]") ??
              (event.currentTarget as HTMLElement))
            : (event.currentTarget as HTMLElement),
        commands,
        head,
      })
    },
    [],
  )

  const close = useCallback(() => {
    setState(undefined)
  }, [])

  const menu =
    state === undefined ? null : (
      <Popover open anchor={state.anchor} at={state.at} minWidth={170} onClose={close}>
        <div role="menu" aria-label="操作">
          {state.head === undefined ? null : <div className="pop__head">{state.head}</div>}
          {state.commands.map((command) =>
            command.pick === undefined ? (
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
            ) : (
              <div
                key={command.label}
                className="pop__pick"
                role="group"
                aria-label={command.label}
              >
                <span className="pop__cmd-icon">{command.icon}</span>
                <span className="pop__pick-label">{command.label}</span>
                {command.pick.map((option) => (
                  <button
                    type="button"
                    key={option.icon}
                    className="pop__pick-one"
                    role="menuitem"
                    aria-label={`${command.label} ${option.icon}`}
                    onClick={() => {
                      close()
                      option.run()
                    }}
                  >
                    {option.icon}
                  </button>
                ))}
                {/* 清掉：回到默认的文件夹图标 */}
                <button
                  type="button"
                  className="pop__pick-one pop__pick-clear"
                  role="menuitem"
                  aria-label={`清除${command.label}`}
                  title="不要图标"
                  onClick={() => {
                    close()
                    command.run()
                  }}
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            ),
          )}
        </div>
      </Popover>
    )

  return { open, menu }
}
