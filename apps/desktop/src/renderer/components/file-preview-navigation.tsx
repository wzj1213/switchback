import type { KeyboardEvent } from "react"
import type { PreviewTarget } from "../workbench.js"
import { ChevronIcon } from "./icons.js"
import { FileListIcon } from "./icons-panel.js"
import { baseName } from "./file-row.js"

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

function tip(target: PreviewTarget | undefined, label: string, key: string): string {
  return target === undefined ? `没有可${label}的文件` : `${label}到 ${baseName(target.path)}（${key}）`
}

export function FilePreviewNavigation({ navigation, onIndex }: {
  navigation: PreviewNavigation | undefined
  onIndex: () => void
}): React.JSX.Element {
  return (
    <span className="file-preview-nav" aria-label="文件阅读导航">
      <button type="button" className="workbench__back" onClick={onIndex} aria-label="返回文件列表">
        <FileListIcon size={13} /> 文件
      </button>
      {navigation === undefined ? null : <>
        <button type="button" className="workbench__icon file-preview-nav__previous" aria-label="后退到上一个文件"
          title={tip(navigation.back, "后退", "⌥←")} disabled={navigation.back === undefined}
          onClick={() => { navigation.onGo(-1) }}><ChevronIcon size={13} /></button>
        <button type="button" className="workbench__icon" aria-label="前进到下一个文件"
          title={tip(navigation.forward, "前进", "⌥→")} disabled={navigation.forward === undefined}
          onClick={() => { navigation.onGo(1) }}><ChevronIcon size={13} /></button>
      </>}
    </span>
  )
}
