import { useEffect, useRef, useState } from "react"
import type { WorkbenchState } from "./workbench.js"
import { trapTab } from "./useModalKeys.js"

const OVERLAY_QUERY = "(max-width: 1120px)"

type FocusState = Pick<WorkbenchState, "page" | "file" | "laneId">

/** 索引直接进最高频入口，详情先落在可返回的键盘锚点。 */
export function workbenchFocusSelector(state: FocusState): string {
  if (state.page === "files") {
    return state.file === undefined
      ? '.workbench__page:not([hidden]) .files-search input'
      : '.workbench__page:not([hidden]) .workbench__back'
  }
  return state.laneId === undefined
    ? ".workbench__tab--on"
    : '.workbench__page:not([hidden]) .workbench__back'
}

function currentOverlay(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(OVERLAY_QUERY).matches
}

function coveredByModal(panel: HTMLElement | null): boolean {
  const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
  const top = modals.at(-1)
  return top !== undefined && top !== panel
}

/** 与 CSS 的抽屉断点保持同步，让语义和焦点契约也跟着变。 */
export function useWorkbenchOverlay(): boolean {
  const [overlay, setOverlay] = useState(currentOverlay)
  useEffect(() => {
    const media = window.matchMedia(OVERLAY_QUERY)
    const update = (): void => { setOverlay(media.matches) }
    update()
    media.addEventListener("change", update)
    return () => { media.removeEventListener("change", update) }
  }, [])
  return overlay
}

/** 打开后进工作台；窄屏锁 Tab；关闭后还给原触发器。 */
export function useWorkbenchKeys(
  state: WorkbenchState,
  overlay: boolean,
  onClose: () => void,
): React.RefObject<HTMLElement | null> {
  const box = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  const modal = useRef(overlay)
  close.current = onClose
  modal.current = overlay
  useEffect(() => {
    if (!state.visible) return undefined
    const panel = box.current
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || coveredByModal(panel)) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        close.current()
      } else if (panel !== null && modal.current) trapTab(event, panel)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      if (origin?.isConnected === true) origin.focus()
    }
  }, [state.visible])
  const selector = workbenchFocusSelector(state)
  const focusKey = `${state.page}\u0000${state.laneId ?? ""}\u0000${state.file?.threadId ?? ""}\u0000${state.file?.path ?? ""}`
  useEffect(() => {
    const panel = box.current
    if (!state.visible || panel === null) return
    const active = document.activeElement
    if (panel.contains(active) && active instanceof HTMLElement && active.matches(".workbench__tab--on")) return
    const target = panel.querySelector<HTMLElement>(selector)
    const focus = target ?? panel
    focus.focus()
  }, [focusKey, overlay, selector, state.visible])
  return box
}
