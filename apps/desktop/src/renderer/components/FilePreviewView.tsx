import { useEffect, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { PreviewTarget } from "../workbench.js"
import { sandboxHtml } from "../safe-html.js"
import { ChevronIcon, CopyIcon, RevealIcon } from "./icons.js"

type Load = { state: "loading" } | { state: "ready"; file: FilePreview }

function usePreview(target: PreviewTarget): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" })
  useEffect(() => {
    let alive = true
    setLoad({ state: "loading" })
    const bridge = window.omni
    if (bridge === undefined) {
      setLoad({ state: "ready", file: {
        kind: "unavailable", path: target.path, name: target.path,
        reason: "failed", message: "桌面桥没有接通，暂时不能读取文件。",
      } })
      return () => { alive = false }
    }
    void bridge.filePreview(target.cwd, target.path).then((file) => {
      if (alive) setLoad({ state: "ready", file })
    }).catch(() => {
      if (alive) setLoad({ state: "ready", file: {
        kind: "unavailable", path: target.path, name: target.path,
        reason: "failed", message: "读取这份文件失败，请稍后重试。",
      } })
    })
    return () => { alive = false }
  }, [target.cwd, target.path])
  return load
}

function Source({ file, onCopy }: {
  file: Extract<FilePreview, { kind: "text" | "html" }>
  onCopy: (text: string) => void
}): React.JSX.Element {
  return (
    <div className="file-source">
      {file.truncated ? <p className="file-preview__note">文件较大，只显示前 1.5 MB。</p> : null}
      <button type="button" className="file-preview__copy" onClick={() => { onCopy(file.text) }}>
        <CopyIcon size={11} /> 复制
      </button>
      <pre><code data-language={file.language}>{file.text}</code></pre>
    </div>
  )
}

function Html({ file, onCopy }: {
  file: Extract<FilePreview, { kind: "html" }>
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<"preview" | "source">(file.truncated ? "source" : "preview")
  return (
    <div className="html-preview">
      <div className="html-preview__switch" role="tablist" aria-label="HTML 查看方式">
        <button type="button" role="tab" aria-selected={mode === "preview"} disabled={file.truncated}
          onClick={() => { setMode("preview") }}>预览</button>
        <button type="button" role="tab" aria-selected={mode === "source"}
          onClick={() => { setMode("source") }}>源码</button>
      </div>
      {mode === "source" ? <Source file={file} onCopy={onCopy} /> : (
        <iframe
          className="html-preview__frame"
          title={`${file.name} 预览`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={sandboxHtml(file.text)}
        />
      )}
    </div>
  )
}

function Content({ file, onCopy }: { file: FilePreview; onCopy: (text: string) => void }): React.JSX.Element {
  if (file.kind === "unavailable") return <p className="workbench__empty">{file.message}</p>
  if (file.kind === "image") return <div className="file-image"><img src={file.dataUrl} alt={file.name} /></div>
  if (file.kind === "html") return <Html file={file} onCopy={onCopy} />
  return <Source file={file} onCopy={onCopy} />
}

export function FilePreviewView({ target, onBack, onReveal, onCopy }: {
  target: PreviewTarget
  onBack: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const load = usePreview(target)
  const path = load.state === "ready" ? load.file.path : target.path
  const name = load.state === "ready" ? load.file.name : target.path.split("/").at(-1) ?? target.path
  return (
    <div className="file-preview">
      <header className="file-preview__head">
        <button type="button" className="workbench__back" onClick={onBack}>
          <ChevronIcon size={11} /> 文件
        </button>
        <strong title={path}>{name}</strong>
        <button type="button" className="workbench__icon" title="在访达中显示"
          aria-label="在访达中显示" onClick={() => { onReveal(path) }}>
          <RevealIcon size={12} />
        </button>
      </header>
      <div className="file-preview__body">
        {load.state === "loading" ? <p className="workbench__empty">正在读取…</p> : (
          <Content key={`${load.file.kind}:${load.file.path}`} file={load.file} onCopy={onCopy} />
        )}
      </div>
    </div>
  )
}
