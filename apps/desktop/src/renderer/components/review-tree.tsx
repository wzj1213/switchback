import { useEffect, useMemo, useState } from "react"
import type { ReviewFile } from "../../shared/review.js"
import { FileIcon } from "./icons-activity.js"
import { ChevronIcon, FolderIcon } from "./icons.js"
import { revealReviewTreePath, reviewTreeDestination, reviewTreeRows,
  type ReviewTreeRow } from "./review-tree-model.js"

function Stat({ file }: { file: ReviewFile }): React.JSX.Element | null {
  if (file.added === 0 && file.removed === 0) return null
  return <span className="rvl__stat">
    {file.added > 0 ? <span className="diffstat__add">+{file.added}</span> : null}
    {file.removed > 0 ? <span className="diffstat__del">−{file.removed}</span> : null}
  </span>
}

function RowIcon({ row }: { row: ReviewTreeRow }): React.JSX.Element {
  if (row.kind === "directory") {
    return <><ChevronIcon open={row.expanded} size={13} /><FolderIcon size={13} /></>
  }
  return <><span className={`rvl__kind rvl__kind--${row.file?.kind}`} aria-hidden="true" />
    <FileIcon /></>
}

function RowTail({ file }: { file: ReviewFile | undefined }): React.JSX.Element | null {
  if (file === undefined) return null
  return <>
    {file.staged === true ? <span className="rvl__staged" title="已在暂存区">已暂存</span> : null}
    <Stat file={file} />
  </>
}

function TreeRowView({ row, index, tabKey, active, onToggle, onPick, onFocus }: {
  row: ReviewTreeRow
  index: number
  tabKey: string | undefined
  active: string | undefined
  onToggle: (path: string) => void
  onPick: (rel: string) => void
  onFocus: () => void
}): React.JSX.Element {
  const file = row.file
  const chosen = file !== undefined && file.rel === active
  const expanded = row.kind === "directory" ? row.expanded : undefined
  const title = file === undefined ? row.path : file.rel
  const click = (): void => {
    if (row.path !== undefined) {
      onToggle(row.path)
      return
    }
    if (file !== undefined) onPick(file.rel)
  }
  return <button type="button" role="treeitem"
    className={`rvl__row rvl__row--${row.kind}${chosen ? " rvl__row--on" : ""}`}
    style={{ paddingInlineStart: 10 + (row.depth - 1) * 14 }} data-tree-index={index}
    data-review-rel={file?.rel} tabIndex={row.key === tabKey ? 0 : -1} aria-level={row.depth}
    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
    aria-current={chosen ? "true" : undefined}
    aria-expanded={expanded} title={title} onClick={click} onFocus={onFocus}>
    <RowIcon row={row} />
    <span className="rvl__base">{row.label}</span>
    <RowTail file={file} />
  </button>
}

export function ReviewTree({ files, active, searching, onPick, children }: {
  files: readonly ReviewFile[]
  active: string | undefined
  searching: boolean
  onPick: (rel: string) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [focused, setFocused] = useState<string | undefined>(undefined)
  const rows = useMemo(() => reviewTreeRows(files, searching ? new Set() : closed),
    [files, searching, closed])
  useEffect(() => {
    setClosed((before) => revealReviewTreePath(before, active))
  }, [active])
  const tabKey = rows.some((row) => row.key === focused) ? focused
    : rows.find((row) => row.file?.rel === active)?.key ?? rows[0]?.key
  const toggle = (path: string): void => {
    setClosed((before) => {
      const next = new Set(before)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".rvl__row")
    const at = Number(button?.dataset.treeIndex ?? -1)
    const destination = reviewTreeDestination(event.key, at, rows)
    if (destination === undefined || button === null) return
    event.preventDefault()
    event.stopPropagation()
    const row = rows[at]
    if (destination === "toggle") {
      if (row?.path !== undefined) toggle(row.path)
      return
    }
    const target = event.currentTarget.querySelector<HTMLButtonElement>(`[data-tree-index="${String(destination)}"]`)
    target?.focus()
    target?.scrollIntoView({ block: "nearest" })
  }
  return <div className="rvl__rows">
    <div role="tree" aria-label="改动文件" onKeyDown={keyDown}>
      {rows.map((row, index) => <TreeRowView key={row.key} row={row} index={index}
        tabKey={tabKey} active={active} onToggle={toggle} onPick={onPick}
        onFocus={() => { setFocused(row.key) }} />)}
    </div>
    {children}
  </div>
}
