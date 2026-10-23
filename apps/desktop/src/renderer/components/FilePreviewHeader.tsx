import type { PreviewTarget } from "../workbench.js"
import { dirHint, outside } from "./file-row.js"
import { RevealIcon } from "./icons.js"
import { ReloadIcon } from "./reload-icon.js"
import { FilePreviewNavigation, type PreviewNavigation } from "./file-preview-navigation.js"
import { useMessages } from "../i18n.js"
import { PREVIEW_HEADER } from "./FilePreviewHeader.messages.js"

function PreviewTitle({ path, cwd, name, refreshing, refreshFailed }: {
  path: string
  cwd: string
  name: string
  refreshing: boolean
  refreshFailed: boolean
}): React.JSX.Element {
  const directory = dirHint(path, cwd)
  const external = outside(path, cwd)
  const m = useMessages(PREVIEW_HEADER)
  const status = refreshing ? m.updating : refreshFailed ? m.updateFailed : undefined
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
          {external ? <span className="file-preview__scope">{m.outside}</span> : null}
          {directory === "" ? null : <span>{directory}</span>}
        </span>
      )}
    </span>
  )
}

function PreviewActions({ target, busy, refreshing, referenceable, revealable,
  onReference, onReload, onReveal }: {
  target: PreviewTarget
  busy: boolean
  refreshing: boolean
  referenceable: boolean
  revealable: boolean
  onReference?: (target: PreviewTarget) => void
  onReload: () => void
  onReveal: () => void
}): React.JSX.Element {
  const m = useMessages(PREVIEW_HEADER)
  return (
    <span className="file-preview__actions">
      {onReference === undefined || !referenceable ? null : (
        <button type="button" className="file-preview__reference"
          title={m.reference} aria-label={m.reference}
          onClick={() => { onReference(target) }}>
          <span aria-hidden="true">@</span>
          <span className="file-preview__reference-text">{m.referenceShort}</span>
        </button>
      )}
      <button type="button" className="workbench__icon" data-tip={m.reload}
        aria-label={m.reload} aria-busy={busy} disabled={busy && !refreshing} onClick={onReload}>
        <ReloadIcon />
      </button>
      {revealable ? (
        <button type="button" className="workbench__icon" data-tip={m.reveal}
          aria-label={m.reveal} onClick={onReveal}>
          <RevealIcon size={14} />
        </button>
      ) : null}
    </span>
  )
}

export function FilePreviewHeader({ target, path, name, refreshing, refreshFailed, busy, referenceable,
  revealable, navigation, onBack, onReference, onReload, onReveal }: {
  target: PreviewTarget
  path: string
  name: string
  refreshing: boolean
  refreshFailed: boolean
  busy: boolean
  referenceable: boolean
  revealable: boolean
  navigation?: PreviewNavigation | undefined
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  onReload: () => void
  onReveal: () => void
}): React.JSX.Element {
  return (
    <header className="file-preview__head">
      <FilePreviewNavigation navigation={navigation} onIndex={onBack} />
      <PreviewTitle path={path} cwd={target.cwd} name={name}
        refreshing={refreshing} refreshFailed={refreshFailed} />
      <PreviewActions target={target} busy={busy} refreshing={refreshing} referenceable={referenceable}
        revealable={revealable} onReference={onReference}
        onReload={onReload} onReveal={onReveal} />
    </header>
  )
}
