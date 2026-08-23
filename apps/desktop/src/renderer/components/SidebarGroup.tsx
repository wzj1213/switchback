import type { ThreadRow } from "@omni/store"
import type { EngineInfo } from "@omni/protocol"
import { tallyOf, type Group } from "../sidebar.js"
import { ChevronIcon, FolderIcon, SpinnerIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { Row, type RowDrag } from "./SidebarRows.js"
import type { RenameCtl } from "./RowName.js"
import { moveKeyProps } from "../moveKey.js"
import { GroupActions } from "./SidebarGroupActions.js"

/*
 * 一个项目：标题行 + 它底下的会话。
 * 从 `SidebarRows.tsx` 拆出来是行数闸门逼的，边界也顺——
 * 那边是「一条会话怎么画」，这边是「一个项目怎么画」。
 */

export function GroupBlock({
  group,
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
      {collapsed ? null : group.rows.length === 0 ? (
        // **空项目也要说句话。** 打开一个文件夹之后它就在这儿了，但还没有会话——
        // 什么都不显示的话，人会以为「打开」这个动作失败了
        <p className="sidebar__empty">还没有会话。点这一行右边的 + 开一条。</p>
      ) : (
        group.rows.map((row) => (
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
            rename={rename}
            {...(onMoveThread === undefined
              ? {}
              : { onMove: (direction: -1 | 1) => onMoveThread(row.thread.id, direction) })}
            {...(drag === undefined ? {} : { drag })}
            onMenu={(e, arm, ren) => {
              onRowMenu(e, row, arm, ren)
            }}
          />
        ))
      )}
    </div>
  )
}

/**
 * 项目标题那一行：展开箭头、图标、名字、在跑的圈、条数、两颗操作键。
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
      e.dataTransfer.dropEffect = "move"
      drag.hoverRow(cwd)
    },
    onDrop: (e) => {
      if (!mine()) return
      e.preventDefault()
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
  const unreadLabel = `${String(unread)} 条跑完了还没看`
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
        <span className="row__slot">
          <ChevronIcon open={!collapsed} size={SIDEBAR_ICON} />
        </span>
        <span className="row__lead">
          {/* 设过图标就用它——**一列长得一样的文件夹图标里，
                  一眼认出哪个是哪个**，这就是它要解决的全部问题 */}
          {icon === undefined ? (
            <FolderIcon size={SIDEBAR_ICON} />
          ) : (
            <span className="row__emoji">{icon}</span>
          )}
        </span>
        <span className="row__label">{group.label}</span>
        {/* 折起来的时候，「这个项目里有没有东西在跑」只剩这一个出口。
                展开时每行自己会转圈，这里就不重复了 */}
        {collapsed && waiting > 0 ? (
          <span className="row__wait" aria-label={`${String(waiting)} 个等你批`}>
            待批
          </span>
        ) : null}
        {collapsed && running > 0 ? (
          <span className="row__spin" aria-label={`${String(running)} 个在跑`}>
            <SpinnerIcon />
          </span>
        ) : null}
        {/* 跑完了还没看的。**不摆数字**：右边已经有一个数（会话条数），
                两个数字挨着谁也说不清哪个是哪个——一颗点说「里面有新东西」就够 */}
        {collapsed && unread > 0 ? (
          <span
            className="row__dot row__dot--unread"
            role="img"
            aria-label={unreadLabel}
            title={unreadLabel}
          />
        ) : null}
        <span className="row__count">{group.rows.length}</span>
      </button>
      <GroupActions group={group} onNewIn={onNewIn} onMenu={onGroupMenu} />
    </div>
  )
}
