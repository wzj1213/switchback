import type { PreviewTarget } from "../workbench.js"
import { dirHint, outside } from "./file-row.js"
import { ChevronIcon, RevealIcon } from "./icons.js"
import { ReloadIcon } from "./reload-icon.js"

function PreviewTitle({ path, cwd, name, refreshing, refreshFailed }: {
  path: string
  cwd: string
  name: string
  refreshing: boolean
  refreshFailed: boolean
}): React.JSX.Element {
  const directory = dirHint(path, cwd)
  const external = outside(path, cwd)
  const status = refreshing ? "正在更新…" : refreshFailed ? "更新失败" : undefined
  return (
    <span className="file-preview__title" title={path}>
      <span className="file-preview__identity">
        <strong>{name}</strong>
        {status === undefined ? null : (
          <span className={`file-preview__status${refreshFailed ? " file-preview__status--failed" : ""}`}
            role="status">{status}</span>
        )}
      </span>
      {directory === "" && !external ? null : (
        <span className="file-preview__path">
          {external ? <span className="file-preview__scope">工作区外</span> : null}
          {directory === "" ? null : <span>{directory}</span>}
        </span>
      )}
    </span>
  )
}

function PreviewActions({ target, busy, refreshing, referenceable, referenceDisabled, revealable,
  onReference, onReload, onReveal }: {
  target: PreviewTarget
  busy: boolean
  refreshing: boolean
  referenceable: boolean
  referenceDisabled: boolean
  revealable: boolean
  onReference?: (target: PreviewTarget) => void
  onReload: () => void
  onReveal: () => void
}): React.JSX.Element {
  const referenceLabel = referenceDisabled ? "继续会话后引用到输入框" : "引用到输入框"
  return (
    <span className="file-preview__actions">
      {onReference === undefined || !referenceable ? null : (
        <button type="button" className="file-preview__reference"
          title={referenceDisabled ? "继续会话后才能引用" : "引用到输入框"}
          aria-label={referenceLabel} disabled={referenceDisabled}
          onClick={() => { onReference(target) }}>
          <span aria-hidden="true">@</span> {referenceDisabled ? "继续后引用" : "引用"}
        </button>
      )}
      <button type="button" className="workbench__icon" title="重新读取文件"
        aria-label="重新读取文件" aria-busy={busy} disabled={busy && !refreshing} onClick={onReload}>
        <ReloadIcon />
      </button>
      {revealable ? (
        <button type="button" className="workbench__icon" title="在访达中显示"
          aria-label="在访达中显示" onClick={onReveal}>
          <RevealIcon size={14} />
        </button>
      ) : null}
    </span>
  )
}

export function FilePreviewHeader({ target, path, name, refreshing, refreshFailed, busy, referenceable,
  referenceDisabled, revealable, onBack, onReference, onReload, onReveal }: {
  target: PreviewTarget
  path: string
  name: string
  refreshing: boolean
  refreshFailed: boolean
  busy: boolean
  referenceable: boolean
  referenceDisabled: boolean
  revealable: boolean
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  onReload: () => void
  onReveal: () => void
}): React.JSX.Element {
  return (
    <header className="file-preview__head">
      <button type="button" className="workbench__back" onClick={onBack}>
        <ChevronIcon size={13} /> 文件
      </button>
      <PreviewTitle path={path} cwd={target.cwd} name={name}
        refreshing={refreshing} refreshFailed={refreshFailed} />
      <PreviewActions target={target} busy={busy} refreshing={refreshing} referenceable={referenceable}
        referenceDisabled={referenceDisabled} revealable={revealable} onReference={onReference}
        onReload={onReload} onReveal={onReveal} />
    </header>
  )
}
