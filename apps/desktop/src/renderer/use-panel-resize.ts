import { useEffect, useRef } from "react"
import { shouldHidePanelAfterResize } from "./panel-layout.js"

/** 窗口从双栏缩进单栏时收起工具面板；窄窗里再次手动打开仍然允许。 */
export function usePanelResize(onNarrow: () => void): void {
  const hide = useRef(onNarrow)
  hide.current = onNarrow
  useEffect(() => {
    const previous = { width: window.innerWidth }
    const onResize = (): void => {
      const next = window.innerWidth
      if (shouldHidePanelAfterResize(previous.width, next)) hide.current()
      previous.width = next
    }
    window.addEventListener("resize", onResize)
    return () => { window.removeEventListener("resize", onResize) }
  }, [])
}
