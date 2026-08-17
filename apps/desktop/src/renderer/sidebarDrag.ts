import { reorder, type Sections } from "./sidebar.js"
import { rowDragOf, useThreadDrag, type ThreadDrag } from "./useThreadDrag.js"
import type { GroupHandlers } from "./components/SidebarSections.js"
import type { RowDrag } from "./components/SidebarRows.js"

/**
 * 侧栏两段之间的拖放接线：「置顶」和「项目」**互为反向落点**。
 *
 * 从 `Sidebar.tsx` 搬出来是行数闸门逼的，但边界也对：那边回答「侧栏由哪几块组成」，
 * 这里回答「一样东西从这一块拖到那一块会发生什么」。
 */

/**
 * 拖放相关的那几个接线。
 *
 * **筛选结果里整套不给**：那时看到的顺序本来就不是真实顺序（命中的几条散在各组里），
 * 拖出来的结果没法解释，所以连拖都不让拖。
 */
export function pinHandlers(o: {
  filtering: boolean
  drag: ThreadDrag
  rowDrag: RowDrag
  onPinThread: (id: string, pin: boolean) => void
  onTogglePin: (cwd: string) => void
  onReorderProjects: (from: string, to: string) => void
}): Partial<GroupHandlers> {
  const item = o.drag.item
  return {
    ...(o.filtering
      ? {}
      : {
          drag: o.rowDrag,
          overPinned: o.drag.overPinned,
          overProjects: o.drag.overProjects,
          dragKind: item?.kind,
          draggingPinned: item?.pinned === true,
          onHoverProjects: o.drag.hoverProjects,
        }),
    // 「置顶」段：会话和项目都收
    onDropPinned: () => {
      o.drag.end()
      if (item === undefined || item.pinned) return
      if (item.kind === "thread") o.onPinThread(item.id, true)
      else o.onTogglePin(item.cwd)
    },
    /**
     * 「项目」段：**收从置顶里拖出来的东西**，落下就是取消置顶。
     *
     * 这是上一版最缺的一条：拖进去容易，拖回来只能去右键菜单里找——
     * 而多数人根本不知道那儿有一项。
     */
    onDropProjects: () => {
      o.drag.end()
      if (item === undefined || !item.pinned) return
      if (item.kind === "thread") o.onPinThread(item.id, false)
      else o.onTogglePin(item.cwd)
    },
    /** 项目落在另一个项目上：排序。 */
    onDropOnProject: (cwd) => {
      o.drag.end()
      if (item?.kind !== "project" || item.cwd === cwd) return
      o.onReorderProjects(item.cwd, cwd)
    },
    onUnpinThread: (id) => {
      o.onPinThread(id, false)
    },
  }
}

/**
 * 侧栏那一整套拖放，组装好交给各段。
 *
 * 做成 hook 而不是让 `Sidebar` 自己拼：那边已经在管筛选、菜单、折叠、改名，
 * 再塞进来一份状态 + 三条落点规则就成了「什么都在里面」。
 *
 * @param sections 当前屏幕上的分段。项目排序要拿它当基准——
 *   **不能拿设置里那份**：第一次拖的时候它还是空的，算出来的新顺序只有一项。
 */
export function useSidebarDrag(o: {
  filtering: boolean
  sections: Sections
  onReorder: (cwd: string, ids: readonly string[]) => void
  onReorderProjects: (order: readonly string[]) => void
  onPinThread: (id: string, pin: boolean) => void
  onTogglePin: (cwd: string) => void
}): Partial<GroupHandlers> {
  const drag = useThreadDrag()
  // 放下时**存整段**而不是存一个「谁在谁前面」的增量：增量要和自动排序合并，
  // 而那正是「一半手动一半自动」——没人说得清新会话该落在哪
  const rowDrag = rowDragOf({
    drag,
    groupOf: (id) => groupOf(o.sections, id),
    onReorder: o.onReorder,
    reorder,
    onPinThread: o.onPinThread,
  })
  return pinHandlers({
    filtering: o.filtering,
    drag,
    rowDrag,
    onPinThread: o.onPinThread,
    onTogglePin: o.onTogglePin,
    /**
     * 项目落在另一个项目上：排序。
     *
     * **落到另一段里的项目上时，顺带跟着那一段走**——把置顶的项目拖到「项目」段
     * 里某一行上，意思显然是「我要把它拿出来」，而不是「排个序但还留在置顶里」。
     * 不这么做的话那一下看起来什么都没发生（它还在置顶段，而置顶段按置顶先后排）。
     */
    onReorderProjects: (from, to) => {
      const pinnedNow = (cwd: string): boolean => o.sections.pinned.some((g) => g.cwd === cwd)
      if (pinnedNow(from) !== pinnedNow(to)) o.onTogglePin(from)
      const now = [...o.sections.pinned, ...o.sections.projects].map((g) => g.cwd)
      o.onReorderProjects(reorder(now, from, to))
    },
  })
}

/**
 * 这条会话属于哪一组、那组现在什么顺序。放下时要拿它算新顺序。
 *
 * **只在置顶和项目两段里找**：「对话」段的会话不属于任何项目，
 * 而手动顺序是按项目存的（`Settings.threadOrder` 的键就是项目路径）。
 */
function groupOf(sections: Sections, id: string): { cwd: string; ids: readonly string[] } | undefined {
  const group = [...sections.pinned, ...sections.projects].find((g) => g.rows.some((r) => r.thread.id === id))
  return group === undefined ? undefined : { cwd: group.cwd, ids: group.rows.map((r) => r.thread.id) }
}
