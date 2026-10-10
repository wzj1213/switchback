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
    // **preventScroll 是必须的**：打开这一帧列宽过渡刚起跑（抽屉在滑），
    // focus 默认的 scroll-into-view 会强制把过渡走完——面板「啪」地全开，
    // 滑动整段消失（实测：同帧 focus 无 preventScroll，打开瞬切；关闭不受影响，
    // 因为还焦那头的元素本来就在可视区里）
    panel?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent): void => {
      const modal = document.querySelector('[aria-modal="true"]')
      // 输入法组字时的 Esc 是取消组字，不是收面板
      if (event.defaultPrevented || event.isComposing || modal !== null || event.key !== "Escape") return
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
