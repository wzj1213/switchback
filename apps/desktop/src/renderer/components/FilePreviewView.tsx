import { useEffect, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { sandboxHtml } from "../safe-html.js"
import { ChevronIcon, CopyIcon, RevealIcon } from "./icons.js"

type Load = { state: "loading" } | {
  state: "ready"
  identity: string
  file: FilePreview
  refreshing: boolean
}
const LOADING: Load = { state: "loading" }

function identityOf(target: PreviewTarget): string {
  return `${target.threadId}\u0000${target.cwd}\u0000${target.path}`
}

function usePreview(target: PreviewTarget, revision: Item | undefined, manual: number): Load {
  const [load, setLoad] = useState<Load>(LOADING)
  const lastTarget = useRef("")
  const identity = identityOf(target)
  useEffect(() => {
    let alive = true
    const refreshing = lastTarget.current === identity
    lastTarget.current = identity
    setLoad((before) => refreshing && before.state === "ready"
      ? { ...before, refreshing: true }
      : LOADING)
    const bridge = window.omni
    if (bridge === undefined) {
      setLoad({ state: "ready", identity, file: {
        kind: "unavailable", path: target.path, name: target.path,
        reason: "failed", message: "桌面桥没有接通，暂时不能读取文件。",
      }, refreshing: false })
      return () => { alive = false }
    }
    const timer = window.setTimeout(() => {
      void bridge.filePreview(target.threadId, target.cwd, target.path).then((file) => {
        if (alive) setLoad({ state: "ready", identity, file, refreshing: false })
      }).catch(() => {
        if (alive) setLoad({ state: "ready", identity, file: {
          kind: "unavailable", path: target.path, name: target.path,
          reason: "failed", message: "读取这份文件失败，请稍后重试。",
        }, refreshing: false })
      })
    }, refreshing ? 100 : 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [manual, revision, target.threadId, target.cwd, target.path])
  return load.state === "ready" && load.identity !== identity ? LOADING : load
}

function ReloadIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.8 5.3V2.7m0 0h-2.6m2.6 0A5.6 5.6 0 1 0 13.4 9" />
    </svg>
  )
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

export function FilePreviewView({ target, revision, onBack, onReveal, onCopy }: {
  target: PreviewTarget
  revision: Item | undefined
  onBack: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [manual, setManual] = useState(0)
  const load = usePreview(target, revision, manual)
  const path = load.state === "ready" ? load.file.path : target.path
  const name = load.state === "ready" ? load.file.name : target.path.split("/").at(-1) ?? target.path
  return (
    <div className="file-preview">
      <header className="file-preview__head">
        <button type="button" className="workbench__back" onClick={onBack}>
          <ChevronIcon size={11} /> 文件
        </button>
        <span className="file-preview__title">
          <strong title={path}>{name}</strong>
          {load.state === "ready" && load.refreshing ? <span>正在更新…</span> : null}
        </span>
        <span className="file-preview__actions">
          <button type="button" className="workbench__icon" title="重新读取文件"
            aria-label="重新读取文件" disabled={load.state === "loading" || load.refreshing}
            onClick={() => { setManual((before) => before + 1) }}>
            <ReloadIcon />
          </button>
          <button type="button" className="workbench__icon" title="在访达中显示"
            aria-label="在访达中显示" onClick={() => { onReveal(path) }}>
            <RevealIcon size={12} />
          </button>
        </span>
      </header>
      <div className="file-preview__body">
        {load.state === "loading" ? <p className="workbench__empty">正在读取…</p> : (
          <Content key={`${load.file.kind}:${load.file.path}`} file={load.file} onCopy={onCopy} />
        )}
      </div>
    </div>
  )
}
