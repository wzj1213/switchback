import type { ThreadRow } from "@switchback/store"
import type { EngineInfo } from "@switchback/protocol"
import { tallyOf, type Group } from "../sidebar.js"
import { GroupEnd } from "./RowEnd.js"
import { FolderIcon, FolderOpenIcon } from "./icons-folder.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { Row, type RowDrag } from "./SidebarRows.js"
import type { RenameCtl } from "./RowName.js"
import { moveKeyProps } from "../moveKey.js"
import { GroupActions } from "./SidebarGroupActions.js"
import { ProjectThreads } from "./project-threads.js"
import type { SidebarNavigation } from "../use-sidebar-navigation.js"

/*
 * 一个项目：标题行 + 它底下的会话。
 * 从 `SidebarRows.tsx` 拆出来是行数闸门逼的，边界也顺——
 * 那边是「一条会话怎么画」，这边是「一个项目怎么画」。
 */

export function GroupBlock({
  group,
  pages,
  collapsed,
  selectedId,
  engines,
  onToggle,
  onSelect,
  onDelete,
  onRowMenu,
  onGroupMenu,
  onNewIn,
  icon,
  rename,
  drag,
  pinned,
  onDropOnProject,
  onMove,
  onMoveThread,
}: {
  group: Group
  pages: SidebarNavigation["pages"]
  /** 拖动接线。传下去这一组的会话就能互相排序；项目行自己也能拖。 */
  drag?: RowDrag
  /** 这个项目挂在「置顶」段里。 */
  pinned?: boolean
  /** 另一个项目落在这一行上：排序。 */
  onDropOnProject?: (cwd: string) => void
  onMove?: (direction: -1 | 1) => void
  onMoveThread?: (id: string, direction: -1 | 1) => void
  collapsed: boolean
  selectedId: string
  /** 引擎清单：行的悬停卡要把 engine id 翻成人话。 */
  engines: readonly EngineInfo[]
  onToggle: () => void
  onRowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void, ren: () => void) => void
  rename?: RenameCtl
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
  /** 在这个项目里新建会话。 */
  onNewIn: (cwd: string) => void
  /** 用户给这个项目设的图标（emoji）。没设就画文件夹。 */
  icon?: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="group">
      <GroupHead
        group={group}
        collapsed={collapsed}
        icon={icon}
        pinned={pinned}
        {...(drag === undefined ? {} : { drag })}
        {...(onDropOnProject === undefined ? {} : { onDropOnProject })}
        onToggle={onToggle}
        onNewIn={onNewIn}
        onGroupMenu={onGroupMenu}
        {...(onMove === undefined ? {} : { onMove })}
      />
      <ProjectThreads rows={group.rows} selectedId={selectedId} collapsed={collapsed} pages={pages} cwd={group.cwd}>
        {(row) => (
          <Row
            key={row.thread.id}
            row={row}
            selected={row.thread.id === selectedId}
            engines={engines}
            onSelect={() => {
              onSelect(row.thread.id)
            }}
            onDelete={() => {
              onDelete(row.thread.id)
            }}
            selectOnPress
            rename={rename}
            {...(onMoveThread === undefined
              ? {}
              : { onMove: (direction: -1 | 1) => onMoveThread(row.thread.id, direction) })}
            {...(drag === undefined ? {} : { drag })}
            onMenu={(e, arm, ren) => {
              onRowMenu(e, row, arm, ren)
            }}
          />
        )}
      </ProjectThreads>
    </div>
  )
}

/**
 * 项目标题那一行：图标（只在用户设了 emoji 时）、名字、在跑的圈、条数、两颗操作键。
 * 从 `GroupBlock` 拆出来是行数闸门逼的，边界也顺——
 * 那边管「这个项目底下有哪些会话」，这边管「这个项目自己长什么样」。
 */
/**
 * 项目行的拖放接线：**它自己能被拖**（进出置顶、和别的项目换位置），
 * 也**只认另一个项目**落在自己身上——会话落在项目行上没有定义，
 * 它要么排序（落在会话行上），要么跨项目（不给）。
 */
function projectDrag(
  cwd: string,
  pinned: boolean,
  drag: RowDrag | undefined,
  onDrop: ((cwd: string) => void) | undefined,
): React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } {
  if (drag === undefined) return {}
  const mine = (): boolean => drag.draggingProject === true
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", cwd)
      drag.start({ kind: "project", cwd, pinned })
    },
    onDragEnd: () => {
      drag.end()
    },
    onDragOver: (e) => {
      if (!mine()) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = "move"
      drag.hoverRow(cwd)
    },
    onDrop: (e) => {
      if (!mine()) return
      e.preventDefault()
      e.stopPropagation()
      onDrop?.(cwd)
    },
  }
}

function GroupHead({
  group,
  collapsed,
  icon,
  pinned,
  drag,
  onDropOnProject,
  onToggle,
  onNewIn,
  onGroupMenu,
  onMove,
}: {
  group: Group
  /** 拖动接线。项目行自己也能拖——见 `useThreadDrag` 那张表。 */
  drag?: RowDrag
  /** 这个项目现在挂在「置顶」段里。拖动时带上，落点据此决定要不要取消置顶。 */
  pinned?: boolean
  /** 另一个项目落在我身上：排序。 */
  onDropOnProject?: (cwd: string) => void
  collapsed: boolean
  icon?: string
  onToggle: () => void
  onNewIn: (cwd: string) => void
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
  onMove?: (direction: -1 | 1) => void
}): React.JSX.Element {
  const { running, waiting, unread } = tallyOf(group)
  return (
    <div
      className={`row row--group${drag?.over === group.cwd ? " row--dropping" : ""}`}
      title={group.cwd}
      {...projectDrag(group.cwd, pinned === true, drag, onDropOnProject)}
      onContextMenu={(e) => {
        onGroupMenu(e, group)
      }}
    >
      <button type="button" className="row__main" {...moveKeyProps(onMove)} onClick={onToggle}>
        {/* 文件夹的**开/合就是折叠态**（作者拍板照 Codex：不要那个 > 箭头）。
            整行可点这件事不变；设过 emoji 的项目用它顶替文件夹——
            一列一样的图标里一眼认出哪个是哪个，这是它解决的全部问题。 */}
        <span className="row__slot">
          {icon === undefined ? (
            collapsed ? <FolderIcon size={SIDEBAR_ICON} /> : <FolderOpenIcon size={SIDEBAR_ICON} />
          ) : (
            <span className="row__emoji">{icon}</span>
          )}
        </span>
        <span className="row__label">{group.label}</span>
        <GroupEnd collapsed={collapsed} waiting={waiting} running={running} unread={unread} count={group.rows.length} />
      </button>
      <GroupActions group={group} onNewIn={onNewIn} onMenu={onGroupMenu} />
    </div>
  )
}
