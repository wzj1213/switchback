import { useEffect, useRef } from "react"

/** 距底多少像素以内算「贴着底」。留一点余量，滚动惯性不至于打断跟随。 */
const NEAR_BOTTOM_PX = 80

/**
 * 新内容到达时滚到底——**但只在用户本来就贴着底时**。
 *
 * 无条件滚到底会在用户往回翻历史时把他弹走，那比不滚更烦。
 * 判据是滚动位置而不是「有没有手动滚过」：后者要维护额外状态，而且
 * 用户滚回底部后就该恢复跟随，用位置判断天然做到这点。
 */
export function useStickToBottom<T extends HTMLElement>(dep: unknown): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const stuck = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el === null) return undefined
    const onScroll = (): void => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el !== null && stuck.current) el.scrollTop = el.scrollHeight
  }, [dep])

  return ref
}
