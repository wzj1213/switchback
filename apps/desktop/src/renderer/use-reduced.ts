import { useEffect, useState } from "react"

/**
 * 系统「减少动效」开着没有。
 *
 * 单独一个文件是因为**它和桌宠没有关系**：登场、开火、旁路的转圈、
 * 未来任何一处动画都要问同一句话。挂在 `usePets` 上导出，
 * 下一个要用它的地方就得 import 一整套桌宠机械。
 */

/** 系统是不是要求少动。**不是读一次就算**：这个开关用户随时会改。 */
export function useReduced(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const on = (e: MediaQueryListEvent): void => {
      setReduced(e.matches)
    }
    mq.addEventListener("change", on)
    return () => {
      mq.removeEventListener("change", on)
    }
  }, [])
  return reduced
}
