import { useEffect, useId, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import { sandboxHtml } from "../safe-html.js"
import { CheckIcon, CopyIcon } from "./icons.js"

const COPY_FLASH_MS = 1200

export function fileCopyLabel(truncated: boolean, copied: boolean): string {
  if (copied) return truncated ? "已复制显示部分" : "已复制"
  return truncated ? "复制显示部分" : "复制"
}

export function fileCopyTitle(truncated: boolean, copied: boolean): string {
  if (copied) return truncated ? "当前显示的前 1.5 MB 已复制" : "文件内容已复制"
  return truncated ? "只复制当前显示的前 1.5 MB" : "复制文件内容"
}

function Source({
  file,
  onCopy,
}: {
  file: Extract<FilePreview, { kind: "text" | "html" }>
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [copy, setCopy] = useState(0)
  useEffect(() => {
    if (copy === 0) return undefined
    const timer = window.setTimeout(() => { setCopy(0) }, COPY_FLASH_MS)
    return () => { window.clearTimeout(timer) }
  }, [copy])
  const copied = copy > 0
  return (
    <div className="file-source" tabIndex={0} aria-label="可横向滚动的文件源码">
      {file.truncated ? <p className="file-preview__note">文件较大，只显示前 1.5 MB。</p> : null}
      <div className="file-source__toolbar">
        <button
          type="button"
          className="file-preview__copy"
          aria-live="polite"
          title={fileCopyTitle(file.truncated, copied)}
          onClick={() => {
            onCopy(file.text)
            setCopy((before) => before + 1)
          }}
        >
          {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
          {fileCopyLabel(file.truncated, copied)}
        </button>
      </div>
      <pre>
        <code data-language={file.language}>{file.text}</code>
      </pre>
    </div>
  )
}

type HtmlMode = "preview" | "source"

/** 截断的 HTML 不是一份完整网页；即使此前选了预览，也只能按源码显示。 */
export function resolvedHtmlMode(picked: HtmlMode, truncated: boolean): HtmlMode {
  return truncated ? "source" : picked
}

export function htmlTabDestination(
  key: string,
  mode: HtmlMode,
  truncated: boolean,
): HtmlMode | undefined {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return undefined
  if (truncated) return "source"
  if (key === "Home") return "preview"
  if (key === "End") return "source"
  if (key === "ArrowLeft") return mode === "source" ? "preview" : "source"
  return mode === "preview" ? "source" : "preview"
}

export function HtmlPreview({
  file,
  onCopy,
}: {
  file: Extract<FilePreview, { kind: "html" }>
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<HtmlMode>(file.truncated ? "source" : "preview")
  const mode = resolvedHtmlMode(picked, file.truncated)
  const preview = useRef<HTMLButtonElement>(null)
  const source = useRef<HTMLButtonElement>(null)
  const base = useId()
  const panelId = `${base}-panel`
  const tabId = `${base}-${mode}`
  const move = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const next = htmlTabDestination(event.key, mode, file.truncated)
    if (next === undefined) return
    event.preventDefault()
    setPicked(next)
    ;(next === "preview" ? preview : source).current?.focus()
  }
  return (
    <div className="html-preview">
      <div className="html-preview__switch" role="tablist" aria-label="HTML 查看方式">
        <button
          ref={preview}
          id={`${base}-preview`}
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          tabIndex={mode === "preview" ? 0 : -1}
          aria-controls={panelId}
          disabled={file.truncated}
          onKeyDown={move}
          onClick={() => {
            setPicked("preview")
          }}
        >
          预览
        </button>
        <button
          ref={source}
          id={`${base}-source`}
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          tabIndex={mode === "source" ? 0 : -1}
          aria-controls={panelId}
          onKeyDown={move}
          onClick={() => {
            setPicked("source")
          }}
        >
          源码
        </button>
      </div>
      <div id={panelId} className="html-preview__panel" role="tabpanel" aria-labelledby={tabId}>
        {mode === "source" ? (
          <Source file={file} onCopy={onCopy} />
        ) : (
          <iframe
            className="html-preview__frame"
            title={`${file.name} 预览`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={sandboxHtml(file.text)}
          />
        )}
      </div>
    </div>
  )
}

export function FilePreviewContent({
  file,
  onCopy,
}: {
  file: FilePreview
  onCopy: (text: string) => void
}): React.JSX.Element {
  if (file.kind === "unavailable") return <p className="workbench__empty">{file.message}</p>
  if (file.kind === "image")
    return (
      <div className="file-image">
        <img src={file.dataUrl} alt={file.name} />
      </div>
    )
  if (file.kind === "html") return <HtmlPreview file={file} onCopy={onCopy} />
  return <Source file={file} onCopy={onCopy} />
}
