import { useState } from "react"

/**
 * 侧栏里拖动会话。
 *
 * ## 规则只有三条，但每一条都是硬的
 *
 * 1. **同一个项目内可以随便排。** 排完整段落盘（见 `Settings.threadOrder`）。
 * 2. **不能拖到别的项目里。** 会话的 `cwd` 是工作区边界的唯一真源——
 *    拖过去要么得改它（那等于把一段对话的执行范围偷偷换掉），
 *    要么不改（那侧栏就在说谎，把一条 A 项目的会话画在 B 项目下面）。
 *    两条都不能接受，所以**跨项目根本不给放**。
 * 3. **可以拖到「置顶」。** 那是唯一允许离开原项目的去处，
 *    而它不改 `cwd`——置顶只是换个地方显示。
 *
 * ## 为什么状态放在 hook 里而不是各行自己管
 *
 * 「现在拖的是谁」「悬在谁上面」是**行与行之间**的事，和改名同理。
 * 各行自己存一份的话，两行同时以为自己是落点，界面上就会出现两条插入线。
 */

export interface DragState {
  /** 正在拖的那条会话 id。没在拖就是 undefined。 */
  id: string | undefined
  /** 它属于哪个项目。跨项目的判据就是拿它和落点比。 */
  cwd: string | undefined
}

export interface ThreadDrag {
  dragging: string | undefined
  /** 现在悬在谁上面（会画一条插入线）。 */
  over: string | undefined
  /** 悬在「置顶」那一段上。 */
  overPinned: boolean
  start: (id: string, cwd: string) => void
  end: () => void
  /** 能不能放在这一条上面。**跨项目一律不能**。 */
  canDropOn: (cwd: string) => boolean
  hoverRow: (id: string) => void
  hoverPinned: () => void
  leave: () => void
}

/**
 * 组装成一行需要的那份接线。
 *
 * 放在这儿而不是 `Sidebar.tsx` 里：那边已经在管筛选、菜单、折叠、改名，
 * 再塞一段拖放组装就成了「什么都在里面」。这一段只关心拖放。
 *
 * @param groupOf 这条会话属于哪一组、那组现在的顺序是什么。放下时要拿它算新顺序。
 */
export function rowDragOf(
  drag: ThreadDrag,
  groupOf: (id: string) => { cwd: string; ids: readonly string[] } | undefined,
  onReorder: (cwd: string, ids: readonly string[]) => void,
  reorder: (ids: readonly string[], from: string, to: string) => readonly string[],
): {
  dragging: string | undefined
  over: string | undefined
  start: (id: string, cwd: string) => void
  end: () => void
  canDropOn: (cwd: string) => boolean
  hoverRow: (id: string) => void
  hoverPinned: () => void
  drop: (beforeId: string) => void
} {
  return {
    dragging: drag.dragging,
    over: drag.over,
    start: drag.start,
    end: drag.end,
    canDropOn: drag.canDropOn,
    hoverRow: drag.hoverRow,
    hoverPinned: drag.hoverPinned,
    drop: (beforeId) => {
      const from = drag.dragging
      drag.end()
      if (from === undefined || from === beforeId) return
      const group = groupOf(from)
      if (group === undefined) return
      onReorder(group.cwd, reorder(group.ids, from, beforeId))
    },
  }
}

/**
 * 能不能放在这个项目里。**这就是「不能跨项目」那条规则的全部**。
 *
 * 会话的 `cwd` 是工作区边界的唯一真源——拖到别的项目里，要么得改它
 *（那等于把一段对话的执行范围偷偷换掉），要么不改（那侧栏就在说谎，
 * 把一条 A 项目的会话画在 B 项目下面）。两条都不能接受。
 *
 * 没在拖的时候也一律不给：别的东西（文件、文本）拖进侧栏不该有任何反应。
 */
export function canDrop(state: DragState, cwd: string): boolean {
  return state.id !== undefined && state.cwd === cwd
}

export function useThreadDrag(): ThreadDrag {
  const [state, setState] = useState<DragState>({ id: undefined, cwd: undefined })
  const [over, setOver] = useState<string | undefined>(undefined)
  const [overPinned, setOverPinned] = useState(false)

  const end = (): void => {
    setState({ id: undefined, cwd: undefined })
    setOver(undefined)
    setOverPinned(false)
  }

  return {
    dragging: state.id,
    over,
    overPinned,
    start: (id, cwd) => {
      setState({ id, cwd })
    },
    end,
    // 没在拖的时候一律不给放：别的东西（文件、文本）拖进侧栏不该有任何反应
    canDropOn: (cwd) => canDrop(state, cwd),
    hoverRow: (id) => {
      setOver(id)
      setOverPinned(false)
    },
    hoverPinned: () => {
      setOverPinned(true)
      setOver(undefined)
    },
    leave: () => {
      setOver(undefined)
      setOverPinned(false)
    },
  }
}
