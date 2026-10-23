import { useEffect, useMemo, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { PreviewTarget } from "../workbench.js"
import { codeLanguage, highlightLines } from "../highlight.js"
import { sourceWindow, SOURCE_LINE_HEIGHT } from "../source-window.js"
import { useCopyFeedback, type CopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon } from "./icons.js"
import type { Locale } from "@switchback/i18n"
import { useLocale } from "../i18n.js"
import { FILE_SOURCE } from "./file-source.messages.js"

export function fileCopyLabel(truncated: boolean, feedback: CopyFeedback, locale: Locale): string {
  const m = FILE_SOURCE[locale]
  if (feedback === "failed") return m.failed
  if (feedback === "copied") return truncated ? m.copiedPart : m.copied
  return truncated ? m.copyPart : m.copy
}

export function fileCopyTitle(truncated: boolean, feedback: CopyFeedback, locale: Locale): string {
  const m = FILE_SOURCE[locale]
  if (feedback === "failed") return m.failedTip
  if (feedback === "copied") return truncated ? m.copiedPartTip : m.copiedTip
  return truncated ? m.copyPartTip : m.copyTip
}

export function Source({ file, onCopy, target }: {
  file: Extract<FilePreview, { kind: "text" | "html" }>
  onCopy: (text: string) => unknown
  target?: PreviewTarget | undefined
}): React.JSX.Element {
  const [feedback, copy] = useCopyFeedback(() => onCopy(file.text))
  const locale = useLocale()
  const m = FILE_SOURCE[locale]
  const box = useRef<HTMLDivElement>(null)
  const positioned = useRef("")
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(800)
  const lines = useMemo(() => file.text.split("\n"), [file.text])
  const paint = useMemo(() => lines.length <= 3000 && file.text.length < 200_000
    ? highlightLines(codeLanguage(file.name), lines) : [], [file.name, file.text, lines])
  const range = sourceWindow(lines.length, scroll, height)
  const line = target?.line
  useEffect(() => {
    const node = box.current
    if (node === null) return undefined
    const observer = new ResizeObserver(() => { setHeight(node.clientHeight) })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    const node = box.current
    if (node === null || line === undefined || line > lines.length) return
    const intent = `${String(line)}:${String(target?.at)}`
    if (positioned.current === intent) return
    positioned.current = intent
    const top = Math.max(0, (line - 1) * SOURCE_LINE_HEIGHT - node.clientHeight / 2 + 44)
    node.scrollTop = top
    setScroll(top)
  }, [line, target?.at, lines.length])
  return (
    <div className="file-source" tabIndex={0} aria-label={m.label} ref={box} data-line-count={lines.length}
      onScroll={(event) => { setScroll(event.currentTarget.scrollTop) }}>
      {file.truncated ? <p className="file-preview__note">{m.truncated}</p> : null}
      {line !== undefined && line > lines.length ? <p className="file-preview__note" role="status">{m.noLine(line)}</p> : null}
      <div className="file-source__toolbar">
        <span className="file-source__info" title={file.language ?? m.text}>{m.lines(lines.length.toLocaleString(locale))}</span>
        {line === undefined ? null : <span className="file-source__info">{m.line(line.toLocaleString(locale))}</span>}
        <button type="button" className="file-preview__copy" aria-live="polite" data-state={feedback}
          data-tip={fileCopyTitle(file.truncated, feedback, locale)} onClick={copy}>
          {feedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {fileCopyLabel(file.truncated, feedback, locale)}
        </button>
      </div>
      <pre style={{ paddingTop: range.start * SOURCE_LINE_HEIGHT, paddingBottom: (lines.length - range.end) * SOURCE_LINE_HEIGHT }}>
        <code data-language={file.language}>
          {lines.slice(range.start, range.end).map((text, offset) => {
            const index = range.start + offset
            return <span key={index} className="source-line" data-line={index + 1} data-selected={line === index + 1}>
              <span className="source-line__number" aria-hidden="true">{index + 1}</span>
              <span>{paint[index]?.map((seg, i) => <span key={i} className={seg.cls}>{seg.text}</span>) ?? text}{"\n"}</span>
            </span>
          })}
        </code>
      </pre>
    </div>
  )
}
