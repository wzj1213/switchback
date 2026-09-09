import { useCallback, useEffect, useRef, useState } from "react"
import { railLayout, type NavPoint, type RailMark } from "./transcript-rail.js"

/**
 * 导航条的量尺：把落点在 DOM 里的位置量出来，交给 `transcript-rail.ts` 算几何。
 *
 * **位置只从 DOM 量，不从数据推。** 一条消息有多高取决于 markdown 排版、
 * 代码块折没折、图片加载完没有——这些数据层一概不知道。
 *
 * 量的时机三种，都必须有：滚动（当下那一格要跟着走）、可视区变化
 *（拖窗口、开工作台）、**内容长高**（流式输出时每一帧都在长）。
 * 最后那条靠 `ResizeObserver` 盯住内容盒子，不是靠 setInterval 去猜。
 */
export function useTranscriptRail(
  scroller: React.RefObject<HTMLElement | null>,
  inner: React.RefObject<HTMLElement | null>,
  points: readonly NavPoint[],
): { marks: readonly RailMark[]; activeId: string | undefined; jump: (id: string) => void } {
  const [view, setView] = useState<{ marks: readonly RailMark[]; activeId: string | undefined }>({
    marks: [], activeId: undefined,
  })
  const raf = useRef(0)
  const live = useRef(points)
  live.current = points

  const measure = useCallback(() => {
    raf.current = 0
    const box = scroller.current
    if (box === null) return
    const top = box.getBoundingClientRect().top
    /*
     * **一次扫出全部落点，不是每个落点扫一遍 DOM。**
     *
     * 这个函数挂在滚动、可视区变化和内容长高上，也就是**滚动的每一帧、
     * 抽屉开合的每一帧、流式输出的每一帧**都要跑一次。上一版对每个落点各发一次
     * `querySelector`：一条问过九十次的会话就是九十次全子树匹配，
     * 而它们要找的东西全在同一棵树里。现在一次 `querySelectorAll` 建表，
     * 剩下的是 Map 查表。
     */
    const nodes = new Map<string, HTMLElement>()
    for (const node of box.querySelectorAll<HTMLElement>("[data-nav]")) {
      const id = node.getAttribute("data-nav")
      // 先到先得：`querySelector` 取的就是第一个，重复 id（不该有）时行为不变
      if (id !== null && !nodes.has(id)) nodes.set(id, node)
    }
    const placed = live.current.flatMap((point) => {
      const node = nodes.get(point.id)
      if (node === undefined) return []
      // 相对**内容顶端**的偏移：可视区里的位置加上已经滚过去的那一段
      return [{ ...point, top: node.getBoundingClientRect().top - top + box.scrollTop }]
    })
    setView((was) => {
      const next = railLayout(placed, {
        scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, scrollTop: box.scrollTop,
      })
      // 同一份结果保留原对象：不然滚动时每一帧都换一次引用，整条导航条重渲染
      const same = was.activeId === next.activeId && was.marks.length === next.marks.length &&
        was.marks.every((mark, i) => mark.id === next.marks[i]?.id && mark.y === next.marks[i]?.y)
      return same ? was : next
    })
  }, [scroller])

  const schedule = useCallback(() => {
    if (raf.current !== 0) return
    raf.current = requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    const box = scroller.current
    const content = inner.current
    if (box === null) return undefined
    schedule()
    box.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(box)
    if (content !== null) observer.observe(content)
    return () => {
      box.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (raf.current !== 0) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [scroller, inner, schedule])

  // 落点增减（又问了一句、折起一轮）也要重量一次
  useEffect(schedule, [points, schedule])

  const jump = useCallback((id: string) => {
    const node = scroller.current?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(id)}"]`)
    node?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [scroller])

  return { ...view, jump }
}
