import { useState } from "react"

/**
 * 侧栏里的拖放。
 *
 * ## 能拖两种东西，而且**每一步都能走回来**
 *
 * | 拖什么 | 放到哪 | 结果 |
 * | --- | --- | --- |
 * | 会话 | 同项目的另一条会话上 | 排序（整段落盘，见 `Settings.threadOrder`） |
 * | 会话 | 「置顶」那一段 | 置顶 |
 * | **置顶的会话** | **「项目」那一段** | **取消置顶** |
 * | 项目 | 另一个项目上 | 排序（`Settings.projectOrder`） |
 * | 项目 | 「置顶」那一段 | 置顶整个项目 |
 * | **置顶的项目** | **「项目」那一段** | **取消置顶** |
 *
 * 加粗那三行是这一版补的。上一版只有「拖进去」没有「拖回来」——
 * **一个只进不出的落点是陷阱**：用户拖了一下发现回不去，只能去右键菜单里找，
 * 而他多半根本不知道那儿有一项。能拖进去的地方就必须能拖出来。
 *
 * ## 唯一仍然不给拖的：会话跨项目
 *
 * 会话的 `cwd` 是工作区边界的唯一真源——拖过去要么得改它（那等于把一段对话的
 * 执行范围偷偷换掉，而引擎那边的进程就跑在那个目录里），要么不改（那侧栏就在说谎，
 * 把一条 A 项目的会话画在 B 项目下面）。两条都不能接受。
 * 说「不」的方式是**平台原生的禁止光标**，在松手之前就看得见。
 *
 * ## 为什么状态放在 hook 里而不是各行自己管
 *
 * 「现在拖的是谁」「悬在谁上面」是**行与行之间**的事，和改名同理。
 * 各行自己存一份的话，两行同时以为自己是落点，界面上就会出现两条插入线。
 */

/** 拖起来的那样东西。**两种，判别式区分**——它决定了哪些落点认它。 */
export type DragItem =
  | { kind: "thread"; id: string; cwd: string; pinned: boolean }
  | { kind: "project"; cwd: string; pinned: boolean }

export interface ThreadDrag {
  /** 正在拖的那样东西。没在拖就是 undefined。 */
  item: DragItem | undefined
  /** 正在拖的会话 id。行要靠它把自己画成「拖动中」。 */
  dragging: string | undefined
  /** 现在悬在谁上面（会画一条插入线）：会话 id 或项目路径。 */
  over: string | undefined
  /** 悬在「置顶」那一段上。 */
  overPinned: boolean
  /** 悬在「项目」那一段上（**拖出置顶**时的落点）。 */
  overProjects: boolean
  start: (item: DragItem) => void
  end: () => void
  /** 这条会话能不能放在那个项目里。**跨项目一律不能**。 */
  canDropOn: (cwd: string) => boolean
  /** 拖的是不是一个项目（项目行据此决定认不认这次落点）。 */
  draggingProject: boolean
  hoverRow: (id: string) => void
  hoverPinned: () => void
  hoverProjects: () => void
  leave: () => void
}

/**
 * 能不能放在这个项目里。**这就是「会话不能跨项目」那条规则的全部。**
 *
 * 没在拖的时候也一律不给：别的东西（文件、文本）拖进侧栏不该有任何反应。
 */
export function canDrop(item: DragItem | undefined, cwd: string): boolean {
  return item?.kind === "thread" && item.cwd === cwd
}

export function useThreadDrag(): ThreadDrag {
  const [item, setItem] = useState<DragItem | undefined>(undefined)
  const [over, setOver] = useState<string | undefined>(undefined)
  const [zone, setZone] = useState<"pinned" | "projects" | undefined>(undefined)

  const hover = (next: "pinned" | "projects"): void => {
    setZone(next)
    setOver(undefined)
  }

  return {
    item,
    dragging: item?.kind === "thread" ? item.id : undefined,
    draggingProject: item?.kind === "project",
    over,
    overPinned: zone === "pinned",
    overProjects: zone === "projects",
    start: setItem,
    end: () => {
      setItem(undefined)
      setOver(undefined)
      setZone(undefined)
    },
    canDropOn: (cwd) => canDrop(item, cwd),
    hoverRow: (id) => {
      setOver(id)
      setZone(undefined)
    },
    hoverPinned: () => {
      hover("pinned")
    },
    hoverProjects: () => {
      hover("projects")
    },
    leave: () => {
      setOver(undefined)
      setZone(undefined)
    },
  }
}

/**
 * 组装成一行需要的那份接线。
 *
 * 放在这儿而不是 `Sidebar.tsx` 里：那边已经在管筛选、菜单、折叠、改名，
 * 再塞一段拖放组装就成了「什么都在里面」。这一段只关心拖放。
 *
 * @param groupOf 这条会话属于哪一组、那组现在的顺序是什么。放下时要拿它算新顺序。
 */
export function rowDragOf(o: {
  drag: ThreadDrag
  groupOf: (id: string) => { cwd: string; ids: readonly string[] } | undefined
  onReorder: (cwd: string, ids: readonly string[]) => void
  reorder: (ids: readonly string[], from: string, to: string | undefined) => readonly string[]
  onPinThread: (id: string, pin: boolean) => void
}): RowDragBox {
  const { drag, groupOf, onReorder, reorder, onPinThread } = o
  return {
    dragging: drag.dragging,
    over: drag.over,
    start: drag.start,
    end: drag.end,
    canDropOn: drag.canDropOn,
    draggingProject: drag.draggingProject,
    hoverRow: drag.hoverRow,
    hoverPinned: drag.hoverPinned,
    drop: (beforeId) => {
      const from = drag.item
      drag.end()
      if (from?.kind !== "thread" || from.id === beforeId) return
      // **落在自己项目的某一行上 = 顺便取消置顶。** 置顶只是「换个地方显示」，
      // 拖回原项目里那一刻它就该从置顶段消失——否则同一条会话会同时出现两处
      if (from.pinned) onPinThread(from.id, false)
      const group = groupOf(beforeId)
      if (group === undefined) return
      onReorder(group.cwd, reorder(group.ids, from.id, beforeId))
    },
  }
}

/** 一行需要的那份（`RowDrag` 的实现体，类型定义在 `SidebarRows.tsx`）。 */
interface RowDragBox {
  dragging: string | undefined
  over: string | undefined
  start: (item: DragItem) => void
  end: () => void
  canDropOn: (cwd: string) => boolean
  draggingProject: boolean
  hoverRow: (id: string) => void
  hoverPinned: () => void
  drop: (beforeId: string) => void
}
