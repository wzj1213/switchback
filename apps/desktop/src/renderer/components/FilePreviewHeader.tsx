import type { PreviewTarget } from "../workbench.js"
import { dirHint, outside } from "./file-row.js"
import { ChevronIcon, RevealIcon } from "./icons.js"

function ReloadIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.8 5.3V2.7m0 0h-2.6m2.6 0A5.6 5.6 0 1 0 13.4 9" />
    </svg>
  )
}

function PreviewTitle({ path, cwd, name, refreshing }: {
  path: string
  cwd: string
  name: string
  refreshing: boolean
}): React.JSX.Element {
  const directory = dirHint(path, cwd)
  const external = outside(path, cwd)
  return (
    <span className="file-preview__title" title={path}>
      <span className="file-preview__identity">
        <strong>{name}</strong>
        {refreshing ? <span className="file-preview__status">正在更新…</span> : null}
      </span>
      {directory === "" ? null : (
        <span className="file-preview__path">
          {external ? <span className="file-preview__scope">工作区外</span> : null}
          <span>{directory}</span>
        </span>
      )}
    </span>
  )
}

function PreviewActions({ target, busy, referenceable, referenceDisabled, revealable,
  onReference, onReload, onReveal }: {
  target: PreviewTarget
  busy: boolean
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
        aria-label="重新读取文件" disabled={busy} onClick={onReload}>
        <ReloadIcon />
      </button>
      {revealable ? (
        <button type="button" className="workbench__icon" title="在访达中显示"
          aria-label="在访达中显示" onClick={onReveal}>
          <RevealIcon size={12} />
        </button>
      ) : null}
    </span>
  )
}

export function FilePreviewHeader({ target, path, name, refreshing, busy, referenceable,
  referenceDisabled, revealable, onBack, onReference, onReload, onReveal }: {
  target: PreviewTarget
  path: string
  name: string
  refreshing: boolean
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
        <ChevronIcon size={11} /> 文件
      </button>
      <PreviewTitle path={path} cwd={target.cwd} name={name} refreshing={refreshing} />
      <PreviewActions target={target} busy={busy} referenceable={referenceable}
        referenceDisabled={referenceDisabled} revealable={revealable} onReference={onReference}
        onReload={onReload} onReveal={onReveal} />
    </header>
  )
}
