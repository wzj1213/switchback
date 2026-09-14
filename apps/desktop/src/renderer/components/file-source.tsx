import { useEffect, useMemo, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { PreviewTarget } from "../workbench.js"
import { codeLanguage, highlightLines } from "../highlight.js"
import { sourceWindow, SOURCE_LINE_HEIGHT } from "../source-window.js"
import { useCopyFeedback, type CopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon } from "./icons.js"

export function fileCopyLabel(truncated: boolean, feedback: CopyFeedback): string {
  if (feedback === "failed") return "复制失败"
  if (feedback === "copied") return truncated ? "已复制显示部分" : "已复制"
  return truncated ? "复制显示部分" : "复制"
}

export function fileCopyTitle(truncated: boolean, feedback: CopyFeedback): string {
  if (feedback === "failed") return "复制失败，请重试"
  if (feedback === "copied") return truncated ? "当前显示的前 1.5 MB 已复制" : "文件内容已复制"
  return truncated ? "只复制当前显示的前 1.5 MB" : "复制文件内容"
}

export function Source({ file, onCopy, target }: {
  file: Extract<FilePreview, { kind: "text" | "html" }>
  onCopy: (text: string) => unknown
  target?: PreviewTarget | undefined
}): React.JSX.Element {
  const [feedback, copy] = useCopyFeedback(() => onCopy(file.text))
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
    <div className="file-source" tabIndex={0} aria-label="可横向滚动的文件源码" ref={box} data-line-count={lines.length}
      onScroll={(event) => { setScroll(event.currentTarget.scrollTop) }}>
      {file.truncated ? <p className="file-preview__note">文件较大，只显示前 1.5 MB。</p> : null}
      {line !== undefined && line > lines.length ? <p className="file-preview__note" role="status">当前内容没有第 {line} 行。</p> : null}
      <div className="file-source__toolbar">
        <span className="file-source__info" title={file.language ?? "文本"}>{lines.length.toLocaleString()} 行</span>
        {line === undefined ? null : <span className="file-source__info">第 {line.toLocaleString()} 行</span>}
        <button type="button" className="file-preview__copy" aria-live="polite" data-state={feedback}
          data-tip={fileCopyTitle(file.truncated, feedback)} onClick={copy}>
          {feedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {fileCopyLabel(file.truncated, feedback)}
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
