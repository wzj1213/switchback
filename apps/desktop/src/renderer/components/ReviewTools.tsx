import type { ReviewFile } from "../../shared/review.js"
import { FileListIcon, LinesIcon, SplitIcon } from "./icons-panel.js"
import { ReloadIcon } from "./reload-icon.js"
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
        onClick={() => { onSplit(!split) }}><SplitIcon /></ToolButton>
      <ToolButton label={list ? "隐藏文件" : "显示文件"} on={list}
        onClick={() => { onList(!list) }}><FileListIcon /></ToolButton>
      <ToolButton label="刷新 Git 差异" onClick={onReload}><ReloadIcon size={14} /></ToolButton>
    </div>
  )
}
