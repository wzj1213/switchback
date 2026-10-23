import type { KeyboardEvent } from "react"
import type { PreviewTarget } from "../workbench.js"
import { ChevronIcon } from "./icons.js"
import { FileListIcon } from "./icons-panel.js"
import { baseName } from "./file-row.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { PREVIEW_NAV } from "./file-preview-navigation.messages.js"

export interface PreviewNavigation {
  back?: PreviewTarget | undefined
  forward?: PreviewTarget | undefined
  onGo: (direction: -1 | 1) => void
}

export function navigatePreviewKey(event: KeyboardEvent, navigation: PreviewNavigation | undefined): void {
  if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : undefined
  if (direction === undefined || navigation === undefined) return
  const target = direction === -1 ? navigation.back : navigation.forward
  if (target === undefined) return
  event.preventDefault()
  event.stopPropagation()
  navigation.onGo(direction)
}

function tip(target: PreviewTarget | undefined, verb: string, key: string, m: (typeof PREVIEW_NAV)[Locale]): string {
  return target === undefined ? m.none(verb) : m.to(verb, baseName(target.path), key)
}

export function FilePreviewNavigation({ navigation, onIndex }: {
  navigation: PreviewNavigation | undefined
  onIndex: () => void
}): React.JSX.Element {
  const m = useMessages(PREVIEW_NAV)
  return (
    <span className="file-preview-nav" aria-label={m.label}>
      <button type="button" className="workbench__back" onClick={onIndex} aria-label={m.index}>
        <FileListIcon size={13} /> {m.files}
      </button>
      {navigation === undefined ? null : <>
        <button type="button" className="workbench__icon file-preview-nav__previous" aria-label={m.backLabel}
          title={tip(navigation.back, m.back, "⌥←", m)} disabled={navigation.back === undefined}
          onClick={() => { navigation.onGo(-1) }}><ChevronIcon size={13} /></button>
        <button type="button" className="workbench__icon" aria-label={m.forwardLabel}
          title={tip(navigation.forward, m.forward, "⌥→", m)} disabled={navigation.forward === undefined}
          onClick={() => { navigation.onGo(1) }}><ChevronIcon size={13} /></button>
      </>}
    </span>
  )
}
