import { useEffect, useRef, useState, type RefObject } from "react"

/** 距底多少像素以内算「贴着底」。留一点余量，惯性滚动不至于打断跟随。 */
const NEAR_BOTTOM_PX = 80

/**
 * 一次滚动之后还跟不跟着底。
 *
 * - **往上翻就松手**，不管离底多近。上一版只按「离底 80px 以内」翻面：流式输出时慢慢往上翻，
 *   两帧之间挪不到 80px，下一次内容长高又被拽回底部——慢慢翻永远翻不上去。
 *   内容变矮把位置挤下来的不算（那时还在底上）。
 * - 回到离底 80px 以内重新跟。
 * - 其余（往下走、还没到底：比如「回到底部」平滑滚动的中途帧）维持原状。上一版在中途帧
 *   就把跟随打掉，按钮闪一下又出来，动画期间长出来的那截也不跟。
 */
export function stickAfterScroll(
  stuck: boolean,
  lastTop: number,
  view: { top: number; height: number; client: number },
): boolean {
  const distance = view.height - view.top - view.client
  if (view.top < lastTop - 1 && distance > 1) return false
  if (distance <= NEAR_BOTTOM_PX) return true
  return stuck
}

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

  const last = useRef(0)

  useEffect(() => {
    const el = scroller.current
    if (el === null) return undefined
    last.current = el.scrollTop
    const onScroll = (): void => {
      const next = stickAfterScroll(stuck.current, last.current, {
        top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight,
      })
      last.current = el.scrollTop
      if (next === stuck.current) return
      stuck.current = next
      setAtBottom(next)
    }
    // 平滑滚动停下时再贴一次：动画的终点是起跑那一刻算好的底，途中长出来的那截要补上
    const onScrollEnd = (): void => {
      if (stuck.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("scrollend", onScrollEnd)
    return () => {
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("scrollend", onScrollEnd)
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
    // 滚动容器自己变矮也要跟（附了图片、输入框长高）：不然最后一张卡被挡一截，也不出「回到底部」
    observer.observe(el)
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
