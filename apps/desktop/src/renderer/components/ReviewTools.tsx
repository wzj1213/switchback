import { useRef, useState } from "react"
import type { ReviewFile } from "../../shared/review.js"
import { FileIcon } from "./icons-activity.js"
import { Popover } from "./Popover.js"

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

function SearchFileIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l2 2v4M3 2.5v11h5M9.5 11.5l3 3M11 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /></svg>
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

function Jump({ files, active, onPick }: {
  files: readonly ReviewFile[]
  active: string | undefined
  onPick: (path: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={trigger} type="button" className="rv__tool" aria-label="跳转到文件"
        title="跳转到文件" aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen((before) => !before) }}><SearchFileIcon /></button>
      <Popover open={open} anchor={trigger.current} minWidth={280} onClose={() => { setOpen(false) }}>
        <div role="menu" aria-label="跳转到文件">
          {files.map((file) => (
            <button key={file.rel} type="button" role="menuitem" className={`pop__item${file.rel === active ? " pop__item--on" : ""}`}
              onClick={() => { setOpen(false); onPick(file.rel) }}>
              <FileIcon /><span className="pop__label">{file.rel}</span>
              <span className="pop__value">+{file.added} −{file.removed}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
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
      <Jump files={files} active={active} onPick={onPick} />
      <ToolButton label={split ? "切换到统一差异" : "切换到分栏差异"} on={split}
        onClick={() => { onSplit(!split) }}><DiffIcon /></ToolButton>
      <ToolButton label={list ? "隐藏文件" : "显示文件"} on={list}
        onClick={() => { onList(!list) }}><FilesIcon /></ToolButton>
      <ToolButton label="刷新 Git 差异" onClick={onReload}><ReloadIcon /></ToolButton>
    </div>
  )
}
