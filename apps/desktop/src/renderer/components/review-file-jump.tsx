import { useId, useRef, useState } from "react"
import type { ReviewFile } from "../../shared/review.js"
import { FileIcon } from "./icons-activity.js"
import { FileSearchIcon } from "./icons-panel.js"
import { Popover } from "./Popover.js"

export function filterReviewJumpFiles(
  files: readonly ReviewFile[],
  query: string,
): readonly ReviewFile[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return files
  return files.filter((file) => {
    const path = file.rel.toLowerCase()
    return terms.every((term) => path.includes(term))
  })
}

export function ReviewFileJump({ files, active, onPick }: {
  files: readonly ReviewFile[]
  active: string | undefined
  onPick: (path: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const resultsId = useId()
  const shown = filterReviewJumpFiles(files, query)
  const close = (): void => {
    setOpen(false)
    setQuery("")
  }
  return (
    <>
      <button ref={trigger} type="button" className="rv__tool" aria-label="跳转到文件"
        title="跳转到文件" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { if (open) close(); else setOpen(true) }}><FileSearchIcon /></button>
      <Popover open={open} anchor={trigger.current} minWidth={320} ariaLabel="跳转到文件"
        onClose={close}>
        <div className="rv-jump">
          <div className="rv-jump__search">
            <FileSearchIcon size={13} />
            <input ref={input} data-popover-autofocus type="search" value={query}
              aria-label="跳转到文件" aria-controls={resultsId} placeholder="跳转到文件…"
              onChange={(event) => { setQuery(event.currentTarget.value) }} />
          </div>
          <div id={resultsId} className="rv-jump__results" role="menu" aria-label="匹配的审核文件">
            {shown.map((file) => (
              <button key={file.rel} type="button" role="menuitem"
                className={`pop__item${file.rel === active ? " pop__item--on" : ""}`}
                aria-current={file.rel === active ? "true" : undefined}
                onClick={() => { close(); onPick(file.rel) }}>
                <FileIcon /><span className="pop__label" title={file.rel}>{file.rel}</span>
                <span className="pop__value">+{file.added} −{file.removed}</span>
              </button>
            ))}
            {shown.length === 0 ? <p className="rv-jump__empty">没有匹配的改动文件</p> : null}
          </div>
        </div>
      </Popover>
    </>
  )
}
