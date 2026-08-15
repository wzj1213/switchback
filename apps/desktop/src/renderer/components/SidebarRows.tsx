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
  idle: "",
  running: " row__dot--running",
  waiting_approval: " row__dot--waiting",
  failed: " row__dot--failed",
}

/** 光靠颜色说不清「要你去做什么」，等待批准这一档补一句字。 */
const NOTE: Partial<Record<ThreadStatus, string>> = { waiting_approval: "待批" }

export function Row({
  row,
  selected,
  onSelect,
  onDelete,
}: {
  row: ThreadRow
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { thread } = row
  // 二次确认做在**同一个按钮**上而不是弹一个对话框：删一个会话不值得打断整个界面，
  // 但也不能点一下就没。照 codex 的 confirmArchiveTask。
  const [confirming, setConfirming] = useState(false)
  return (
    <div className={`row row--thread${selected ? " row--selected" : ""}`} title={thread.cwd}>
      <button type="button" className="row__main" aria-selected={selected} onClick={onSelect}>
        <span className="row__slot">
          <span className={`row__dot${DOT_CLASS[thread.status]}`} />
        </span>
        <span className="row__label">{rowLabelOf(row)}</span>
        {NOTE[thread.status] === undefined ? null : <span className="row__note">{NOTE[thread.status]}</span>}
      </button>
      <button
        type="button"
        className={`row__act${confirming ? " row__act--danger" : ""}`}
        aria-label={confirming ? "确认删除" : "删除会话"}
        title={confirming ? "再点一次就真的删了，不可撤销" : "删除会话"}
        onClick={() => {
          if (confirming) onDelete()
          else setConfirming(true)
        }}
        onBlur={() => {
          setConfirming(false)
        }}
      >
        {confirming ? "确认" : "×"}
      </button>
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
}: {
  group: Group
  collapsed: boolean
  selectedId: string
  onToggle: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="group">
      <button type="button" className="row row--group" onClick={onToggle} title={group.cwd}>
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
            />
          ))}
    </div>
  )
}

