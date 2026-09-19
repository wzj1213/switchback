import type { RowDrag } from "./components/SidebarRows.js"
import type { DropEdge } from "./sidebar.js"

export function dropEdge(y: number, rect: { top: number; height: number }): DropEdge {
  return y < rect.top + rect.height / 2 ? "before" : "after"
}

/** 行落点消费事件，不能再冒泡到外层置顶/取消置顶区域。 */
export function rowDragProps(id: string, cwd: string, pinned: boolean, drag: RowDrag | undefined):
React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } {
  if (drag === undefined) return {}
  const accepts = (): boolean => !pinned && drag.canDropOn(cwd)
  return {
    draggable: true,
    onDragStart: (event) => {
      event.stopPropagation()
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", id)
      drag.start({ kind: "thread", id, cwd, pinned })
    },
    onDragEnd: () => drag.end(),
    onDragOver: (event) => {
      if (!accepts()) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = "move"
      drag.hoverRow(id, dropEdge(event.clientY, event.currentTarget.getBoundingClientRect()))
    },
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      if (drag.over === id) drag.hoverRow("")
    },
    onDrop: (event) => {
      if (!accepts()) return
      event.preventDefault()
      event.stopPropagation()
      drag.drop(id, dropEdge(event.clientY, event.currentTarget.getBoundingClientRect()))
    },
  }
}
