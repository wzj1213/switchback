import { useEffect, useRef, useState } from "react"

/** 距底多少像素以内算「贴着底」。留一点余量，滚动惯性不至于打断跟随。 */
const NEAR_BOTTOM_PX = 80

/**
 * 新内容到达时滚到底——**但只在用户本来就贴着底时**。
 *
 * 无条件滚到底会在用户往回翻历史时把他弹走，那比不滚更烦。
 * 判据是滚动位置而不是「有没有手动滚过」：后者要维护额外状态，而且
 * 用户滚回底部后就该恢复跟随，用位置判断天然做到这点。
 *
 * ## 为什么从「数条数」换成「量高度」
 *
 * 上一版的触发条件是 `items.length + (turn ? 1 : 0)`——**条数**。
 * 而一条正在流的消息，从第一个字到最后一个字，条数**始终是 1**。
 * 于是真实时序是：`item.started` 到达时滚到底（那时这条消息还是空的），
 * 之后所有 delta 长出来的正文**全部落在折线以下**——
 * 流式正文几乎从头到尾没进过可视区。轮次结束时 turn 被摘掉，
 * 条数从 N+1 掉回 N，effect 又跑一次，于是猛地弹到底。
 *
 * 落到眼睛里就是「憋半天，最后啪一下全出来」。用户说的「不喜欢打字感」，
 * 有一半是这个造成的：他看到的不是逐渐长出来，是攒够了一次砸下来。
 *
 * 所以改成盯**内容盒的尺寸**（抄 dsh 的 `ChatView.tsx:328-341`）：
 * 长一点跟一点。delta、工具行展开、图片加载完撑高，全都算数。
 */
export function useStickToBottom<T extends HTMLElement, I extends HTMLElement>(): {
  /** 挂在滚动容器上。 */
  scroller: React.RefObject<T | null>
  /** 挂在**内容**容器上（滚动容器的那个子节点）。尺寸变化由它触发跟随。 */
  inner: React.RefObject<I | null>
  /** 现在是不是贴着底。界面据此决定要不要显示「回到底部」。 */
  atBottom: boolean
  /** 手动滚到底。 */
  toBottom: () => void
} {
  const scroller = useRef<T | null>(null)
  const inner = useRef<I | null>(null)
  const stuck = useRef(true)
  /**
   * 同一件事既要给 effect 用（ref，读的时候要最新值）又要给渲染用（state）。
   * **只在真的翻面时 setState**——滚动事件一秒能来上百次，
   * 每次都 setState 等于把整棵树重渲染上百遍。
   */
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
      // 所以**不需要**再记一份「这次是我自己滚的」台账。少一份状态少一处不同步。
      if (stuck.current) el.scrollTop = el.scrollHeight
    }
    const observer = new ResizeObserver(follow)
    // 只盯内容盒。以后往滚动容器里加兄弟节点（比如空态那块），
    // 记得一并 observe，否则它撑高时不会触发跟随
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
      // **每次现读，不缓存**：用户中途改「减少动态效果」要立刻生效。
      // CSSOM View 里只有 `behavior: "auto"` 才去查 CSS 的 `scroll-behavior`，
      // 显式传 smooth 的话任何媒体查询都拦不住——而这是全应用位移最大的一段动画
      const gentle = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      el.scrollTo({ top: el.scrollHeight, behavior: gentle ? "smooth" : "instant" })
    },
  }
}
