import type { NavPoint, RailMark } from "./transcript-rail.js"

/** 内容位置只在布局/内容变化时测量；滚动时复用这份几何。 */
export function measureNavPoints(box: HTMLElement, points: readonly NavPoint[]): readonly (NavPoint & { top: number })[] {
  const top = box.getBoundingClientRect().top
  const scrollTop = box.scrollTop
  const nodes = new Map<string, HTMLElement>()
  for (const node of box.querySelectorAll<HTMLElement>("[data-nav]")) {
    const id = node.getAttribute("data-nav")
    if (id !== null && !nodes.has(id)) nodes.set(id, node)
  }
  return points.flatMap((point) => {
    const node = nodes.get(point.id)
    return node === undefined ? [] : [{ ...point, top: node.getBoundingClientRect().top - top + scrollTop }]
  })
}

/** 比较完整的可见状态：同一位置上的标题、权重、引擎也会在流式期间更新。 */
export function sameRailMarks(a: readonly RailMark[], b: readonly RailMark[]): boolean {
  return a.length === b.length && a.every((mark, i) => {
    const next = b[i]
    return next !== undefined && mark.id === next.id && mark.y === next.y && mark.width === next.width &&
      mark.text === next.text && mark.engine === next.engine && mark.ids.length === next.ids.length &&
      mark.ids.every((id, j) => id === next.ids[j])
  })
}
