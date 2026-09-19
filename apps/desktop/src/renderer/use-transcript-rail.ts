import { useCallback, useEffect, useRef, useState } from "react"
import { railLayout, type NavPoint, type RailMark } from "./transcript-rail.js"
import { measureNavPoints, sameRailMarks } from "./transcript-geometry.js"

/** 大纲独立订阅滚动；隐藏时不扫描正文，纯滚动时不重复读取全部消息的位置。 */
export function useTranscriptRail(
  scroller: React.RefObject<HTMLElement | null>,
  inner: React.RefObject<HTMLElement | null>,
  points: readonly NavPoint[],
  nav: React.RefObject<HTMLElement | null>,
): { marks: readonly RailMark[]; activeId: string | undefined; jump: (id: string) => void } {
  const [view, setView] = useState<{ marks: readonly RailMark[]; activeId: string | undefined }>({
    marks: [], activeId: undefined,
  })
  const raf = useRef(0)
  const live = useRef(points)
  live.current = points
  const dirty = useRef(true)
  const placed = useRef<ReturnType<typeof measureNavPoints>>([])

  const measure = useCallback(() => {
    raf.current = 0
    const box = scroller.current
    // CSS 容器查询是是否可见的唯一真源，不另写一份宽度阈值。
    if (box === null || nav.current === null || nav.current.getClientRects().length === 0) return
    if (dirty.current) {
      placed.current = measureNavPoints(box, live.current)
      dirty.current = false
    }
    const next = railLayout(placed.current, {
      scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, scrollTop: box.scrollTop,
    })
    setView((was) => was.activeId === next.activeId && sameRailMarks(was.marks, next.marks) ? was : next)
  }, [scroller, nav])
  const schedule = useCallback(() => {
    if (raf.current === 0) raf.current = requestAnimationFrame(measure)
  }, [measure])
  const invalidate = useCallback(() => {
    dirty.current = true
    schedule()
  }, [schedule])

  useEffect(() => {
    const box = scroller.current
    const content = inner.current
    if (box === null) return undefined
    invalidate()
    box.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(invalidate)
    observer.observe(box)
    if (content !== null) observer.observe(content)
    return () => {
      box.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (raf.current !== 0) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [scroller, inner, schedule, invalidate])
  useEffect(invalidate, [points, invalidate])

  const jump = useCallback((id: string) => {
    const node = scroller.current?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(id)}"]`)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    node?.scrollIntoView({ block: "start", behavior: reduced ? "instant" : "smooth" })
  }, [scroller])
  return { ...view, jump }
}
