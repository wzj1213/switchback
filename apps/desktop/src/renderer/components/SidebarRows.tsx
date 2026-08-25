import { useEffect, useState } from "react"
import type { EngineInfo } from "@omni/protocol"
import { rowLabelOf, type SidebarRow } from "../sidebar.js"
import { Dot, RowEnd } from "./RowEnd.js"
import { useRowPeek } from "./RowPeek.js"
import { RowActions } from "./RowActions.js"
import { RowName, type RenameCtl } from "./RowName.js"
import type { DragItem } from "../useThreadDrag.js"
import { moveKeyProps } from "../moveKey.js"

/** 一行需要的拖放接线。状态在 `useThreadDrag`，这里只是把它接到 DOM 事件上。 */
export interface RowDrag {
  dragging: string | undefined
  over: string | undefined
  start: (item: DragItem) => void
  end: () => void
  canDropOn: (cwd: string) => boolean
  /** 拖的是不是一个项目。项目行据此决定认不认这次落点。 */
  draggingProject?: boolean
  hoverRow: (id: string) => void
  /** 悬在「置顶」那一段上。 */
  hoverPinned: () => void
  /** 放在这一条**前面**。 */
  drop: (beforeId: string) => void
}

/**
 * 侧栏里的行。
 *
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但边界是对的：
 * 那边管「侧栏由哪几块组成」，这边管「一行长什么样」。
 * 两边共用 `app.css` 里那套 `.row` —— 对齐靠的是它，不是各自的 padding。
 */

/**
 * 一行的拖放事件。
 *
 * 抽出来是行数闸门逼的，但它确实自成一件事——而且这里藏着**跨项目怎么挡住的**：
 * `onDragOver` 不调 `preventDefault` 就等于「这儿不能放」，
 * 于是鼠标上是禁止标，用户在松手之前就知道不行。**用平台原生的方式说不，
 * 比放下之后弹一句「不能跨项目」好得多。**
 *
 * ## 一条不写下来就会再犯的约束
 *
 * `onDragStart` 里的 `drag.start()` 会当场 setState、当场重渲染整条侧栏。
 * **那一次重渲染不许让这一行的位置变。** 只要它上面多出（或少掉）任何占位的东西，
 * Chromium 会**直接取消这次拖拽**：`dragstart` 照常触发、谁也没 `preventDefault`、
 * 节点也还连着，就是拖不动，而且一声不吭。
 *
 * 实测（0.0.206 的包，CDP 量的）：拖项目行 → 「置顶」段插进一句「松手就置顶了…」
 * → 这一行从 y=333 掉到 391 → 拖拽没起来。绝对定位的东西不算数（它不占位），
 * 换底色、改透明度也不算数——**只有「占位的东西变了」才致命**。
 */
function dragProps(
  id: string,
  cwd: string,
  pinned: boolean,
  drag: RowDrag | undefined,
): React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } {
  if (drag === undefined) return {}
  return {
    draggable: true,
    onDragStart: (e) => {
      // 拖的是一条会话，不是它的文字。不设的话有的地方会把行内文本当拖拽内容
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", id)
      // **带上「它现在是不是置顶的」**：落点靠这一条决定要不要顺手取消置顶
      drag.start({ kind: "thread", id, cwd, pinned })
    },
    onDragEnd: () => {
      drag.end()
    },
    onDragOver: (e) => {
      if (!drag.canDropOn(cwd)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      drag.hoverRow(id)
    },
    onDrop: (e) => {
      if (!drag.canDropOn(cwd)) return
      e.preventDefault()
      drag.drop(id)
    },
  }
}

/** 一行的 class。拼在 JSX 里的话那一行会长到看不出是在拼什么。 */
function rowClass(o: {
  flat: boolean
  selected: boolean
  dragging: boolean
  dropping: boolean
  unread: boolean
}): string {
  return [
    "row row--thread",
    o.flat ? "row--flat" : "",
    o.selected ? "row--selected" : "",
    o.unread ? "row--unread" : "",
    o.dragging ? "row--dragging" : "",
    o.dropping ? "row--dropping" : "",
  ]
    .filter((c) => c !== "")
    .join(" ")
}

export function Row({
  row,
  selected,
  pinned = false,
  flat = false,
  aside,
  engines,
  onSelect,
  onDelete,
  onMenu,
  rename,
  drag,
  onMove,
}: {
  row: SidebarRow
  selected: boolean
  /** 不在项目组里（筛选结果、最近段）：不缩进那一级。 */
  flat?: boolean
  /** 右侧的一小段附注。「最近」段用它写项目名——那一段是跨项目的。 */
  aside?: string
  /** 这一行现在挂在「置顶」段里。拖动时要带上，落点据此决定要不要取消置顶。 */
  pinned?: boolean
  /** 引擎清单：悬停卡要把 engine id 翻成人话（`labelOf` 找不到就退原 id）。 */
  engines: readonly EngineInfo[]
  onSelect: () => void
  onDelete: () => void
  /** 右键或点 `···`。`arm` 让菜单能把这一行切进删除确认态，`ren` 切进改名态。 */
  onMenu: (event: React.MouseEvent, arm: () => void, ren: () => void) => void
  /** 改名。**状态由上层持有**——同时只能有一行在改，而这是行与行之间的事。 */
  rename?: RenameCtl
  /**
   * 拖动。**状态同样由上层持有**——「现在拖的是谁、悬在谁上面」是行与行之间的事，
   * 各行自存一份的话会同时出现两条插入线。不传就是这一行不能拖（筛选结果里就不给拖：
   * 那时看到的顺序本来就不是真实顺序，拖出来的结果没法解释）。
   */
  drag?: RowDrag
  /** `Alt+↑/↓` 与右键菜单共用的排序动作。 */
  onMove?: (direction: -1 | 1) => void
}): React.JSX.Element {
  const { thread } = row
  // 后台跑完、还没打开过的那条要**亮着**：整行提亮 + 状态点点起来（见 `RowEnd`）。
  // 选中的那条不算——你正看着它
  const unread = row.unread === true && !selected
  const dropping = drag?.over === thread.id && drag.dragging !== thread.id
  // 二次确认做在**同一个按钮**上而不是弹一个对话框：删一个会话不值得打断整个界面，
  // 但也不能点一下就没。照 codex 的 confirmArchiveTask。
  const [confirming, setConfirming] = useState(false)
  const arm = (): void => {
    setConfirming(true)
  }
  const startRename = (): void => {
    rename?.start(thread.id)
  }
  /**
   * **武装状态要自己解除。**
   *
   * 上一版只靠确认按钮的 `onBlur`，而从右键菜单武装时那个按钮根本没拿到过焦点，
   * 于是 blur 永远不来——那一行就一直挂着「确认」，**下一次点它直接把会话删了**，
   * 而用户以为自己点的是「更多操作」。删除不可撤销，不能有这种残留。
   */
  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => {
      setConfirming(false)
    }, 4000)
    return () => {
      clearTimeout(timer)
    }
  }, [confirming])
  // 悬停卡：改名时不弹（输入框正在这一行上），拖动中不弹（会盖住落点高亮）
  const peek = useRowPeek({ drag, disabled: rename?.id === thread.id, row, engines })
  return (
    <div
      className={rowClass({
        flat,
        selected,
        unread,
        dragging: drag?.dragging === thread.id,
        dropping,
      })}
      {...peek.handlers}
      {...dragProps(thread.id, thread.cwd, pinned, drag)}
      onContextMenu={(e) => {
        onMenu(e, arm, startRename)
      }}
      // 双击标题就能改名。菜单里那一项是给「不知道能双击」的人准备的，
      // 而知道的人不该为一个高频小动作绕一趟菜单
      onDoubleClick={startRename}
    >
      <button
        type="button"
        className="row__main"
        aria-current={selected ? "page" : undefined}
        {...moveKeyProps(onMove)}
        onClick={onSelect}
      >
        <span className="row__slot">
          <Dot status={thread.status} unread={unread} />
        </span>
        <RowName
          value={rowLabelOf(row)}
          editing={rename?.id === thread.id}
          onCommit={(title) => {
            rename?.commit(thread.id, title)
          }}
          onCancel={() => {
            rename?.done()
          }}
        />
        <RowEnd thread={thread} unread={unread} {...(aside === undefined ? {} : { aside })} />
      </button>
      <RowActions
        confirming={confirming}
        onDelete={onDelete}
        onDisarm={() => {
          setConfirming(false)
        }}
        onMenu={(e) => {
          onMenu(e, arm, startRename)
        }}
      />
      {peek.card}
    </div>
  )
}
