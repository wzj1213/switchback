import { useEffect, useState } from "react"
import type { PreviewTarget } from "./workbench.js"

const FALLBACK_REFRESH_MS = 15_000
const WATCH_DEBOUNCE_MS = 80

/** 原生文件事件负责即时更新；聚焦与低频轮询兜住丢事件、缺失后重建等边界。 */
export function useFilePreviewPulse(active: boolean, target: PreviewTarget): number {
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const refresh = (): void => { setPulse((before) => before + 1) }
    window.addEventListener("focus", refresh)
    const timer = window.setInterval(refresh, FALLBACK_REFRESH_MS)
    return () => {
      window.removeEventListener("focus", refresh)
      window.clearInterval(timer)
    }
  }, [active])
  useEffect(() => {
    const bridge = window.omni
    if (!active || bridge === undefined) return undefined
    let timer: number | undefined
    const stop = bridge.watchFile(target.threadId, target.cwd, target.path, () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => { setPulse((before) => before + 1) }, WATCH_DEBOUNCE_MS)
    })
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      stop()
    }
  }, [active, target.threadId, target.cwd, target.path])
  return pulse
}
