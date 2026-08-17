import { useEffect, useState } from "react"
import type { ThreadStatus } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { rowLabelOf } from "../sidebar.js"
import { EllipsisIcon, SpinnerIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { RowName, type RenameCtl } from "./RowName.js"
import type { DragItem } from "../useThreadDrag.js"

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

const DOT_CLASS: Record<ThreadStatus, string> = {
  // 起引擎那几百毫秒：和「跑着」用同一个呼吸动画，因为**对用户来说就是同一件事**
  //（有东西在动、还不能输入），没必要为它发明第三种视觉语言
  starting: " row__dot--running",
  idle: "",
  running: " row__dot--running",
  waiting_approval: " row__dot--waiting",
  failed: " row__dot--failed",
}

/** 光靠颜色说不清「要你去做什么」，等待批准这一档补一句字。 */
const NOTE: Partial<Record<ThreadStatus, string>> = { waiting_approval: "待批", starting: "启动中" }

/**
 * 一行的拖放事件。
 *
 * 抽出来是行数闸门逼的，但它确实自成一件事——而且这里藏着**跨项目怎么挡住的**：
 * `onDragOver` 不调 `preventDefault` 就等于「这儿不能放」，
 * 于是鼠标上是禁止标，用户在松手之前就知道不行。**用平台原生的方式说不，
 * 比放下之后弹一句「不能跨项目」好得多。**
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

/**
 * 行尾那颗按钮：平时是「更多」，武装之后变成「确认」。
 *
 * **二次确认做在同一颗按钮上**而不是弹对话框：删一个会话不值得打断整个界面，
 * 但也不能点一下就没。照 codex 的 confirmArchiveTask。
 */
function RowActions({
  confirming,
  onDelete,
  onDisarm,
  onMenu,
}: {
  confirming: boolean
  onDelete: () => void
  onDisarm: () => void
  onMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  if (confirming) {
    return (
      <button
        type="button"
        className="row__act row__act--danger"
        aria-label="确认删除"
        title="再点一次就真的删了，不可撤销"
        onClick={onDelete}
        onBlur={onDisarm}
      >
        确认
      </button>
    )
  }
  return (
    <button type="button" className="row__act" aria-label="更多操作" title="更多操作" onClick={onMenu}>
      <EllipsisIcon size={SIDEBAR_ICON} />
    </button>
  )
}

/** 一行的 class。拼在 JSX 里的话那一行会长到看不出是在拼什么。 */
function rowClass(o: { flat: boolean; selected: boolean; dragging: boolean; dropping: boolean }): string {
  return [
    "row row--thread",
    o.flat ? "row--flat" : "",
    o.selected ? "row--selected" : "",
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
  onSelect,
  onDelete,
  onMenu,
  rename,
  drag,
}: {
  row: ThreadRow
  selected: boolean
  /** 不在项目组里（筛选结果、最近段）：不缩进那一级。 */
  flat?: boolean
  /** 右侧的一小段附注。「最近」段用它写项目名——那一段是跨项目的。 */
  aside?: string
  /** 这一行现在挂在「置顶」段里。拖动时要带上，落点据此决定要不要取消置顶。 */
  pinned?: boolean
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
}): React.JSX.Element {
  const { thread } = row
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
  return (
    <div
      className={rowClass({ flat, selected, dragging: drag?.dragging === thread.id, dropping })}
      title={thread.cwd}
      {...dragProps(thread.id, thread.cwd, pinned, drag)}
      onContextMenu={(e) => {
        onMenu(e, arm, startRename)
      }}
      // 双击标题就能改名。菜单里那一项是给「不知道能双击」的人准备的，
      // 而知道的人不该为一个高频小动作绕一趟菜单
      onDoubleClick={startRename}
    >
      <button type="button" className="row__main" aria-selected={selected} onClick={onSelect}>
        <span className="row__slot">
          <span className={`row__dot${DOT_CLASS[thread.status]}`} />
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
        {aside === undefined ? null : <span className="row__aside">{aside}</span>}
        {/* 跑着的时候右侧转一个圈。**这是唯一能在不切会话的情况下看出「那边还在忙」
            的地方**——状态点太小、又和「有未读」这类含义抢同一个位置 */}
        {thread.status === "running" ? (
          <span className="row__spin" aria-label="正在运行">
            <SpinnerIcon />
          </span>
        ) : null}
        {NOTE[thread.status] === undefined ? null : <span className="row__note">{NOTE[thread.status]}</span>}
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
    </div>
  )
}


