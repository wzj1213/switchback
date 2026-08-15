import { useState } from "react"
import type { ThreadStatus } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { rowLabelOf, type Group } from "../sidebar.js"
import { ChevronIcon, FolderIcon } from "./icons.js"

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

export function Row({
  row,
  selected,
  flat = false,
  aside,
  onSelect,
  onDelete,
  onMenu,
}: {
  row: ThreadRow
  selected: boolean
  /** 不在项目组里（筛选结果、最近段）：不缩进那一级。 */
  flat?: boolean
  /** 右侧的一小段附注。「最近」段用它写项目名——那一段是跨项目的。 */
  aside?: string
  onSelect: () => void
  onDelete: () => void
  /** 右键或点 `···`。`arm` 让菜单能把这一行切进删除确认态。 */
  onMenu: (event: React.MouseEvent, arm: () => void) => void
}): React.JSX.Element {
  const { thread } = row
  // 二次确认做在**同一个按钮**上而不是弹一个对话框：删一个会话不值得打断整个界面，
  // 但也不能点一下就没。照 codex 的 confirmArchiveTask。
  const [confirming, setConfirming] = useState(false)
  const arm = (): void => {
    setConfirming(true)
  }
  return (
    <div
      className={`row row--thread${flat ? " row--flat" : ""}${selected ? " row--selected" : ""}`}
      title={thread.cwd}
      onContextMenu={(e) => {
        onMenu(e, arm)
      }}
    >
      <button type="button" className="row__main" aria-selected={selected} onClick={onSelect}>
        <span className="row__slot">
          <span className={`row__dot${DOT_CLASS[thread.status]}`} />
        </span>
        <span className="row__label">{rowLabelOf(row)}</span>
        {aside === undefined ? null : <span className="row__aside">{aside}</span>}
        {NOTE[thread.status] === undefined ? null : <span className="row__note">{NOTE[thread.status]}</span>}
      </button>
      {confirming ? (
        <button
          type="button"
          className="row__act row__act--danger"
          aria-label="确认删除"
          title="再点一次就真的删了，不可撤销"
          onClick={onDelete}
          onBlur={() => {
            setConfirming(false)
          }}
        >
          确认
        </button>
      ) : (
        <button
          type="button"
          className="row__act"
          aria-label="更多操作"
          title="更多操作"
          onClick={(e) => {
            onMenu(e, arm)
          }}
        >
          ···
        </button>
      )}
    </div>
  )
}

export function GroupBlock({
  group,
  collapsed,
  selectedId,
  onToggle,
  onSelect,
  onDelete,
  onRowMenu,
  onGroupMenu,
}: {
  group: Group
  collapsed: boolean
  selectedId: string
  onToggle: () => void
  onRowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void) => void
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="group">
      <button
        type="button"
        className="row row--group"
        onClick={onToggle}
        title={group.cwd}
        onContextMenu={(e) => {
          onGroupMenu(e, group)
        }}
      >
        <span className="row__slot">
          <ChevronIcon open={!collapsed} />
        </span>
        <span className="row__lead">
          <FolderIcon />
        </span>
        <span className="row__label">{group.label}</span>
        <span className="row__count">{group.rows.length}</span>
      </button>
      {collapsed
        ? null
        : group.rows.map((row) => (
            <Row
              key={row.thread.id}
              row={row}
              selected={row.thread.id === selectedId}
              onSelect={() => {
                onSelect(row.thread.id)
              }}
              onDelete={() => {
                onDelete(row.thread.id)
              }}
              onMenu={(e, arm) => {
                onRowMenu(e, row, arm)
              }}
            />
          ))}
    </div>
  )
}

