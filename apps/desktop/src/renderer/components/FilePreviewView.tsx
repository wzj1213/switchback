import { useEffect, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { baseName } from "./file-row.js"
import { FilePreviewHeader } from "./FilePreviewHeader.js"
import { FilePreviewContent } from "./file-preview-content.js"

type Load =
  | { state: "loading" }
  | {
      state: "ready"
      identity: string
      file: FilePreview
      refreshing: boolean
    }
const LOADING: Load = { state: "loading" }
const REFRESH_MS = 15_000

export function canRevealPreview(file: FilePreview | undefined, path: string): boolean {
  return path !== "" && !(file?.kind === "unavailable" && file.reason === "missing")
}

/** 缺失文件不能再交给输入框；二进制或暂时预览失败的路径仍可交给原生引擎处理。 */
export const canReferencePreview = canRevealPreview

function identityOf(target: PreviewTarget): string {
  return `${target.threadId}\u0000${target.cwd}\u0000${target.path}`
}

function usePreview({ target, revision, stamp, manual, active }: {
  target: PreviewTarget
  revision: Item | undefined
  stamp: string
  manual: number
  active: boolean
}): Load {
  const [load, setLoad] = useState<Load>(LOADING)
  const [visit, setVisit] = useState(0)
  const lastTarget = useRef("")
  const identity = identityOf(target)
  useEffect(() => {
    if (!active) return undefined
    const bump = (): void => {
      setVisit((before) => before + 1)
    }
    window.addEventListener("focus", bump)
    const timer = window.setInterval(bump, REFRESH_MS)
    return () => {
      window.removeEventListener("focus", bump)
      window.clearInterval(timer)
    }
  }, [active])
  useEffect(() => {
    if (!active) return undefined
    let alive = true
    const refreshing = lastTarget.current === identity
    lastTarget.current = identity
    setLoad((before) =>
      refreshing && before.state === "ready" ? { ...before, refreshing: true } : LOADING,
    )
    const bridge = window.omni
    if (bridge === undefined) {
      setLoad({
        state: "ready",
        identity,
        file: {
          kind: "unavailable",
          path: target.path,
          name: target.path,
          reason: "failed",
          message: "桌面桥没有接通，暂时不能读取文件。",
        },
        refreshing: false,
      })
      return () => {
        alive = false
      }
    }
    const timer = window.setTimeout(
      () => {
        void bridge
          .filePreview(target.threadId, target.cwd, target.path)
          .then((file) => {
            if (alive) setLoad({ state: "ready", identity, file, refreshing: false })
          })
          .catch(() => {
            if (alive)
              setLoad({
                state: "ready",
                identity,
                file: {
                  kind: "unavailable",
                  path: target.path,
                  name: target.path,
                  reason: "failed",
                  message: "读取这份文件失败，请稍后重试。",
                },
                refreshing: false,
              })
          })
      },
      refreshing ? 100 : 0,
    )
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [active, manual, revision, stamp, target.threadId, target.cwd, target.path, visit])
  return load.state === "ready" && load.identity !== identity ? LOADING : load
}

export function FilePreviewView({
  target,
  revision,
  stamp,
  active = true,
  onBack,
  onReference,
  referenceDisabled = false,
  onReveal,
  onCopy,
}: {
  target: PreviewTarget
  revision: Item | undefined
  stamp: string
  active?: boolean
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  referenceDisabled?: boolean
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [manual, setManual] = useState(0)
  const load = usePreview({ target, revision, stamp, manual, active })
  const path = load.state === "ready" ? load.file.path : target.path
  const name = load.state === "ready" ? load.file.name : baseName(target.path)
  const revealable = canRevealPreview(load.state === "ready" ? load.file : undefined, path)
  const referenceable = canReferencePreview(load.state === "ready" ? load.file : undefined, path)
  const refreshing = load.state === "ready" && load.refreshing
  return (
    <div className="file-preview">
      <FilePreviewHeader
        target={target}
        path={path}
        name={name}
        refreshing={refreshing}
        busy={load.state === "loading" || refreshing}
        referenceable={referenceable}
        referenceDisabled={referenceDisabled}
        revealable={revealable}
        onBack={onBack}
        onReference={onReference}
        onReload={() => {
          setManual((before) => before + 1)
        }}
        onReveal={() => {
          onReveal(path)
        }}
      />
      <div className="file-preview__body">
        {load.state === "loading" ? (
          <p className="workbench__empty">正在读取…</p>
        ) : (
          <FilePreviewContent
            key={`${load.file.kind}:${load.file.path}`}
            file={load.file}
            onCopy={onCopy}
          />
        )}
      </div>
    </div>
  )
}
