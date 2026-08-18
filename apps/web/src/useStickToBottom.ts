import { useEffect, useRef, useState, type RefObject } from "react"

/** 距底多少像素以内算「贴着底」。留一点余量，惯性滚动不至于打断跟随。 */
const NEAR_BOTTOM_PX = 80

/**
 * 新内容到达时滚到底——**但只在用户本来就贴着底时**。
 *
 * 无条件滚到底会在用户往回翻历史时把他弹走，那比不滚更烦。
 * 判据是滚动位置而不是「有没有手动滚过」：后者要维护额外状态，而且
 * 用户滚回底部后就该恢复跟随，用位置判断天然做到这点。
 *
 * ## 为什么盯尺寸，不数条数
 *
 * **这一条桌面端已经踩过一次，这里原本又踩了一遍。** 上一版的触发条件是
 * `items.length`——而一条正在流的消息，从第一个字到最后一个字，条数始终是 1。
 * 真实时序：`item.started` 到达时滚到底（那时这条消息还是空的），
 * 之后几百条 delta 只改 `item.text`，条数不变 → effect 再也不跑 →
 * **流式正文全部长在折线以下，从头到尾没进过可视区**。
 *
 * 平滑滚动还会把这个失效锁死：动画期间内容仍在长高并持续触发 scroll 事件，
 * 动画结束时离底部已经很远，`stuck` 被打成 false 且再也回不来——
 * 连下一条新消息都不会再弹到底。所以**跟随用瞬时**，平滑只留给
 * 用户主动点「回到底部」。
 *
 * 详细论证见 `apps/desktop/src/renderer/useStickToBottom.ts` 的文件头。
 */
export function useStickToBottom<T extends HTMLElement, I extends HTMLElement>(): {
  /** 挂在滚动容器上。 */
  scroller: RefObject<T | null>
  /** 挂在**内容**容器上（滚动容器的那个子节点）。尺寸变化由它触发跟随。 */
  inner: RefObject<I | null>
  /** 现在是不是贴着底。界面据此决定要不要显示「回到底部」。 */
  atBottom: boolean
  /** 手动滚到底。 */
  toBottom: () => void
} {
  const scroller = useRef<T | null>(null)
  const inner = useRef<I | null>(null)
  const stuck = useRef(true)
  // 同一件事既要给 effect 用（ref，读的时候要最新值）又要给渲染用（state）。
  // **只在真的翻面时 setState**——滚动事件一秒能来上百次
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const el = scroller.current
    if (el === null) return undefined
    const onScroll = (): void => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
      if (near === stuck.current) return
      stuck.current = near
      setAtBottom(near)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
    }
  }, [])

  useEffect(() => {
    const el = scroller.current
    const box = inner.current
    if (el === null || box === null || typeof ResizeObserver === "undefined") return undefined
    const follow = (): void => {
      // 判据是位置式的：程序化滚到底之后算出来是 `0 <= 80`，自我纠正，
      // 所以**不需要**再记一份「这次是我自己滚的」台账
      if (stuck.current) el.scrollTop = el.scrollHeight
    }
    const observer = new ResizeObserver(follow)
    observer.observe(box)
    return () => {
      observer.disconnect()
    }
  }, [])

  return {
    scroller,
    inner,
    atBottom,
    toBottom: () => {
      const el = scroller.current
      if (el === null) return
      stuck.current = true
      setAtBottom(true)
      // **每次现读，不缓存**：用户中途改「减少动态效果」要立刻生效
      const gentle = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      el.scrollTo({ top: el.scrollHeight, behavior: gentle ? "smooth" : "instant" })
    },
  }
}
