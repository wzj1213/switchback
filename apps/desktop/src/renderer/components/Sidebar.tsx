import { useState } from "react"
import type { ThreadStatus } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"

const DOT_CLASS: Record<ThreadStatus, string> = {
  idle: "",
  running: " thread__dot--running",
  waiting_approval: " thread__dot--waiting",
  failed: " thread__dot--failed",
}

/**
 * 文件夹图标。用内联 SVG 而不是 emoji 或字形：
 * emoji 是彩色的、和这套单色界面不搭，字形（`⌸` 之类）在多数字体里
 * 会退化成一个含糊的方框。内联 SVG 跟着 `currentColor` 走，永远对。
 */
function FolderIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.75 3.5A1.25 1.25 0 0 1 3 2.25h3l1.5 1.5H13a1.25 1.25 0 0 1 1.25 1.25v7A1.25 1.25 0 0 1 13 13.25H3A1.25 1.25 0 0 1 1.75 12z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 光靠颜色说不清「要你去做什么」，等待批准这一档补一句字。 */
const NOTE: Partial<Record<ThreadStatus, string>> = { waiting_approval: "待批" }

interface Props {
  rows: readonly ThreadRow[]
  selectedId: string
  onSelect: (id: string) => void
  /** 在当前工作区另开一个会话 */
  onNew: () => void
  /** 弹系统目录框，选一个工作区再开会话 */
  onOpenFolder: () => void
  /** 删除会话。**不可撤销**，所以由行内二次确认把关。 */
  onDelete: (id: string) => void
}

function Row({
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
  const { thread, preview } = row
  // 二次确认做在**同一个按钮**上而不是弹一个对话框：删一个会话不值得打断整个界面，
  // 但也不能点一下就没。照 codex 的 confirmArchiveTask。
  const [confirming, setConfirming] = useState(false)
  return (
    <div className={`thread${selected ? " thread--selected" : ""}`} title={thread.cwd}>
      <button type="button" className="thread__main" aria-selected={selected} onClick={onSelect}>
        <span className="thread__line">
          <span className={`thread__dot${DOT_CLASS[thread.status]}`} />
          <span className="thread__label">{thread.title}</span>
          {NOTE[thread.status] === undefined ? null : (
            <span className="thread__note">{NOTE[thread.status]}</span>
          )}
        </span>
        {/* 同一个工作区可以开好几个会话，光靠目录名它们在侧栏里长得一模一样 */}
        {preview === undefined ? null : <span className="thread__preview">{preview}</span>}
      </button>
      <button
        type="button"
        className={`thread__del${confirming ? " thread__del--confirm" : ""}`}
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

export function Sidebar({ rows, selectedId, onSelect, onNew, onOpenFolder, onDelete }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div className="sidebar__brand">
          omni<span>同文</span>
        </div>
      </div>
      <div className="sidebar__actions">
        <button className="sbtn" type="button" onClick={onNew} title="在当前工作区另开一个会话">
          ＋ 新建会话
        </button>
        <button
          className="sbtn sbtn--icon"
          type="button"
          onClick={onOpenFolder}
          title="打开其他文件夹…"
          aria-label="打开其他文件夹"
        >
          <FolderIcon />
        </button>
      </div>
      <div className="sidebar__group">会话</div>
      <div className="sidebar__list">
        {rows.map((row) => (
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
    </aside>
  )
}
