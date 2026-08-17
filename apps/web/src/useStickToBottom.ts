import { useEffect, useRef, type RefObject } from "react"

/**
 * 贴底：新内容来了就滚到底，**除非用户自己往上翻了**。
 *
 * 少了后半句这东西就是敌人：你正在读上面某一段输出，它每来一条 delta
 * 就把你拽回底部。判据是「离底部还有多远」，阈值给得宽一点（一屏的四分之一），
 * 因为手机上的惯性滚动很难正好停在 0。
 *
 * 动画尊重系统的「减少动态效果」——**每次现读**，不缓存到模块顶层：
 * 用户可以在应用开着的时候改这个设置。
 */
const NEAR_BOTTOM_RATIO = 0.25

export function useStickToBottom(ref: RefObject<HTMLElement | null>, signal: number): void {
  const stuck = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el === null) return undefined
    const onScroll = (): void => {
      const slack = el.scrollHeight - el.scrollTop - el.clientHeight
      stuck.current = slack <= el.clientHeight * NEAR_BOTTOM_RATIO
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
    }
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (el === null || !stuck.current) return
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
  }, [ref, signal])
}
