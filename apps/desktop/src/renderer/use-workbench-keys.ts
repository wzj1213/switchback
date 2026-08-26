import { useEffect, useRef } from "react"
import type { WorkbenchState } from "./workbench.js"

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

function coveredByModal(panel: HTMLElement | null): boolean {
  const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
  const top = modals.at(-1)
  return top !== undefined && top !== panel
}

/** 打开后进工作台；Esc 关闭后还给原触发器。 */
export function useWorkbenchKeys(
  state: WorkbenchState,
  onClose: () => void,
): React.RefObject<HTMLElement | null> {
  const box = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
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
      }
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
    const keepsRow = state.page === "files" && state.file === undefined
      && active instanceof HTMLElement && active.matches(".file-row")
    if (panel.contains(active) && active instanceof HTMLElement
      && (active.matches(".workbench__tab--on") || keepsRow)) return
    const target = panel.querySelector<HTMLElement>(selector)
    const focus = target ?? panel
    focus.focus()
  }, [focusKey, selector, state.visible])
  return box
}
