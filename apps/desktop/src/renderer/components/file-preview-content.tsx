import { useEffect, useId, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import { sandboxHtml } from "../safe-html.js"
import { Source } from "./file-source.js"
import { TextPreview } from "./text-preview.js"
import type { PreviewTarget } from "../workbench.js"
export { fileCopyLabel, fileCopyTitle } from "./file-source.js"

type CopyText = (text: string) => unknown

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
  target,
}: {
  file: Extract<FilePreview, { kind: "html" }>
  onCopy: CopyText
  target?: PreviewTarget | undefined
}): React.JSX.Element {
  const [picked, setPicked] = useState<HtmlMode>(file.truncated || target?.line !== undefined ? "source" : "preview")
  const mode = resolvedHtmlMode(picked, file.truncated)
  useEffect(() => { if (target?.line !== undefined) setPicked("source") }, [target?.line, target?.at])
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
          <Source file={file} onCopy={onCopy} target={target} />
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
  target,
}: {
  file: FilePreview
  onCopy: CopyText
  target?: PreviewTarget | undefined
}): React.JSX.Element {
  if (file.kind === "unavailable") return <p className="workbench__empty">{file.message}</p>
  if (file.kind === "image")
    return (
      <div className="file-image">
        <img src={file.dataUrl} alt={file.name} />
      </div>
    )
  if (file.kind === "html") return <HtmlPreview file={file} onCopy={onCopy} target={target} />
  return <TextPreview file={file} onCopy={onCopy} target={target} />
}
