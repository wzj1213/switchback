import { useEffect, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { sandboxHtml } from "../safe-html.js"
import { baseName } from "./file-row.js"
import { CopyIcon } from "./icons.js"
import { FilePreviewHeader } from "./FilePreviewHeader.js"

type Load = { state: "loading" } | {
  state: "ready"
  identity: string
  file: FilePreview
  refreshing: boolean
}
const LOADING: Load = { state: "loading" }

export function canRevealPreview(file: FilePreview | undefined, path: string): boolean {
  return path !== "" && !(file?.kind === "unavailable" && file.reason === "missing")
}

/** 缺失文件不能再交给输入框；二进制或暂时预览失败的路径仍可交给原生引擎处理。 */
export const canReferencePreview = canRevealPreview

function identityOf(target: PreviewTarget): string {
  return `${target.threadId}\u0000${target.cwd}\u0000${target.path}`
}

function usePreview(target: PreviewTarget, revision: Item | undefined, stamp: string, manual: number): Load {
  const [load, setLoad] = useState<Load>(LOADING)
  const [visit, setVisit] = useState(0)
  const lastTarget = useRef("")
  const identity = identityOf(target)
  useEffect(() => {
    const bump = (): void => { setVisit((before) => before + 1) }
    window.addEventListener("focus", bump)
    return () => { window.removeEventListener("focus", bump) }
  }, [])
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
  }, [manual, revision, stamp, target.threadId, target.cwd, target.path, visit])
  return load.state === "ready" && load.identity !== identity ? LOADING : load
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

export function FilePreviewView({ target, revision, stamp, onBack, onReference, referenceDisabled = false,
  onReveal, onCopy }: {
  target: PreviewTarget
  revision: Item | undefined
  stamp: string
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  referenceDisabled?: boolean
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [manual, setManual] = useState(0)
  const load = usePreview(target, revision, stamp, manual)
  const path = load.state === "ready" ? load.file.path : target.path
  const name = load.state === "ready" ? load.file.name : baseName(target.path)
  const revealable = canRevealPreview(load.state === "ready" ? load.file : undefined, path)
  const referenceable = canReferencePreview(load.state === "ready" ? load.file : undefined, path)
  const refreshing = load.state === "ready" && load.refreshing
  return (
    <div className="file-preview">
      <FilePreviewHeader target={target} path={path} name={name} refreshing={refreshing}
        busy={load.state === "loading" || refreshing} referenceable={referenceable}
        referenceDisabled={referenceDisabled} revealable={revealable} onBack={onBack}
        onReference={onReference} onReload={() => { setManual((before) => before + 1) }}
        onReveal={() => { onReveal(path) }} />
      <div className="file-preview__body">
        {load.state === "loading" ? <p className="workbench__empty">正在读取…</p> : (
          <Content key={`${load.file.kind}:${load.file.path}`} file={load.file} onCopy={onCopy} />
        )}
      </div>
    </div>
  )
}
