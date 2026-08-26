import { useEffect, useRef } from "react"
import { restorePanelFocus } from "./panel-focus.js"

/** 非模态编辑组：打开时接住焦点，Esc 关闭，关闭后回到原触发器。 */
export function usePanelKeys(onClose: () => void, active = true): React.RefObject<HTMLElement | null> {
  const box = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!active) return undefined
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const panel = box.current
    panel?.focus()
    const onKey = (event: KeyboardEvent): void => {
      const modal = document.querySelector('[aria-modal="true"]')
      if (event.defaultPrevented || modal !== null || event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      close.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      restorePanelFocus(origin)
    }
  }, [active])
  return box
}
