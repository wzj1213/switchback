import type { ReviewFile } from "../../shared/review.js"
import { ReviewFileJump } from "./review-file-jump.js"

function ToolButton({ label, on, onClick, children }: {
  label: string
  on?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" className={`rv__tool${on === true ? " rv__tool--on" : ""}`}
      aria-label={label} title={label} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

function LinesIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h8M5 8h8M5 13h8M2.5 3h.01M2.5 8h.01M2.5 13h.01" /></svg>
}

function DiffIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M8 3v10M4.5 6h1.5M10 10h1.5" /></svg>
}

function FilesIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h4l1-1h6v9h-11zM5 7h6M5 9.5h6" /></svg>
}

function ReloadIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 6A5.2 5.2 0 1 0 13 9M12.8 2.8V6H9.6" /></svg>
}

export function Tools({ split, onSplit, context, onContext, onReload, list, onList, files, active, onPick }: {
  split: boolean
  onSplit: (on: boolean) => void
  context: number
  onContext: (n: number) => void
  onReload: () => void
  list: boolean
  onList: (on: boolean) => void
  files: readonly ReviewFile[]
  active: string | undefined
  onPick: (path: string) => void
}): React.JSX.Element {
  const expanded = context === 9999
  return (
    <div className="rv__tools" aria-label="差异查看工具">
      <ToolButton label={expanded ? "收起全部差异" : "展开全部差异"} on={expanded}
        onClick={() => { onContext(expanded ? 3 : 9999) }}><LinesIcon /></ToolButton>
      <ReviewFileJump files={files} active={active} onPick={onPick} />
      <ToolButton label={split ? "切换到统一差异" : "切换到分栏差异"} on={split}
        onClick={() => { onSplit(!split) }}><DiffIcon /></ToolButton>
      <ToolButton label={list ? "隐藏文件" : "显示文件"} on={list}
        onClick={() => { onList(!list) }}><FilesIcon /></ToolButton>
      <ToolButton label="刷新 Git 差异" onClick={onReload}><ReloadIcon /></ToolButton>
    </div>
  )
}
