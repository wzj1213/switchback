import { useEffect, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { Item } from "@switchback/protocol"
import type { PreviewTarget } from "../workbench.js"
import { baseName } from "./file-row.js"
import { FilePreviewHeader } from "./FilePreviewHeader.js"
import { FilePreviewContent } from "./file-preview-content.js"
import { useFilePreviewPulse } from "../use-file-preview-pulse.js"
import { FileLinkScope } from "./message-link.js"
import { navigatePreviewKey, type PreviewNavigation } from "./file-preview-navigation.js"

export type PreviewLoad =
  | { state: "loading" }
  | {
      state: "ready"
      identity: string
      file: FilePreview
      refreshing: boolean
      refreshFailed: boolean
    }
const LOADING: PreviewLoad = { state: "loading" }

function readyLoad(identity: string, file: FilePreview): PreviewLoad {
  return { state: "ready", identity, file, refreshing: false, refreshFailed: false }
}

/** 自动刷新暂时失败时保留上一份正文；首次读取没有旧内容，仍然诚实显示失败。 */
export function failedPreviewLoad(
  before: PreviewLoad,
  identity: string,
  failure: FilePreview,
): PreviewLoad {
  if (before.state !== "ready" || before.identity !== identity) return readyLoad(identity, failure)
  return { ...before, refreshing: false, refreshFailed: true }
}

function transientFailure(file: FilePreview): boolean {
  return file.kind === "unavailable" && file.reason === "failed"
}

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
}): PreviewLoad {
  const [load, setLoad] = useState<PreviewLoad>(LOADING)
  const lastTarget = useRef("")
  const identity = identityOf(target)
  const visit = useFilePreviewPulse(active, target)
  useEffect(() => {
    if (!active) return undefined
    let alive = true
    const refreshing = lastTarget.current === identity
    lastTarget.current = identity
    setLoad((before) =>
      refreshing && before.state === "ready"
        ? { ...before, refreshing: true, refreshFailed: false }
        : LOADING,
    )
    const bridge = window.switchback
    if (bridge === undefined) {
      setLoad(readyLoad(identity, {
        kind: "unavailable",
        path: target.path,
        name: target.path,
        reason: "failed",
        message: "桌面桥没有接通，暂时不能读取文件。",
      }))
      return () => {
        alive = false
      }
    }
    const timer = window.setTimeout(
      () => {
        void bridge
          .filePreview(target.threadId, target.cwd, target.path)
          .then((file) => {
            if (!alive) return
            setLoad((before) => refreshing && transientFailure(file)
              ? failedPreviewLoad(before, identity, file)
              : readyLoad(identity, file))
          })
          .catch(() => {
            if (!alive) return
            const failure: FilePreview = {
              kind: "unavailable",
              path: target.path,
              name: target.path,
              reason: "failed",
              message: "读取这份文件失败，请稍后重试。",
            }
            setLoad((before) => refreshing
              ? failedPreviewLoad(before, identity, failure)
              : readyLoad(identity, failure))
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
  navigation,
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
  navigation?: PreviewNavigation | undefined
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
  const refreshFailed = load.state === "ready" && load.refreshFailed
  return (
    <div className="file-preview" onKeyDown={(event) => { navigatePreviewKey(event, navigation) }}>
      <FilePreviewHeader
        target={target}
        path={path}
        name={name}
        refreshing={refreshing}
        refreshFailed={refreshFailed}
        busy={load.state === "loading" || refreshing}
        referenceable={referenceable}
        referenceDisabled={referenceDisabled}
        revealable={revealable}
        navigation={navigation}
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
          <FileLinkScope threadId={target.threadId} cwd={target.cwd} documentPath={path}>
            <FilePreviewContent key={`${load.file.kind}:${load.file.path}`}
              file={load.file} onCopy={onCopy} target={target} />
          </FileLinkScope>
        )}
      </div>
    </div>
  )
}
