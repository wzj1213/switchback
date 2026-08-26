import { useLayoutEffect, useState } from "react"

export interface Placement {
  left: number
  top: number
}

const GAP = 6
const MARGIN = 8

/** 同一个落点保留原对象，避免 ResizeObserver 的等值回报再触发一轮渲染。 */
export function stablePlacement(
  current: Placement | undefined,
  next: Placement | undefined,
): Placement | undefined {
  if (current?.left === next?.left && current?.top === next?.top) return current
  return next
}

/** 贴着鼠标点弹。默认往右下，装不下才翻。 */
function placeAtPoint(point: { x: number; y: number }, panel: HTMLElement): Placement {
  const p = panel.getBoundingClientRect()
  const left = point.x + p.width + MARGIN <= window.innerWidth ? point.x : point.x - p.width
  const top = point.y + p.height + MARGIN <= window.innerHeight ? point.y : point.y - p.height
  return { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) }
}

function placeAtAnchor(anchor: HTMLElement, panel: HTMLElement): Placement {
  const a = anchor.getBoundingClientRect()
  const p = panel.getBoundingClientRect()
  const above = a.top - p.height - GAP
  const below = a.bottom + GAP
  const top = above >= MARGIN ? above : Math.min(below, window.innerHeight - p.height - MARGIN)
  const left = Math.max(MARGIN, Math.min(a.left, window.innerWidth - p.width - MARGIN))
  return { left, top }
}

/**
 * 浮层定位只认几何与显式内容页，不认 React children 的对象身份。
 * children 每次父级渲染都会换对象；拿它当依赖会让流式输出期间菜单反复重排。
 */
interface PopoverLayoutProps {
  open: boolean
  anchor: HTMLElement | null
  point: { x: number; y: number } | undefined
  panel: React.RefObject<HTMLDivElement | null>
  contentKey: string | number | undefined
}

export function usePopoverLayout({
  open,
  anchor,
  point,
  panel,
  contentKey,
}: PopoverLayoutProps): Placement | undefined {
  const [at, setAt] = useState<Placement | undefined>(undefined)

  useLayoutEffect(() => {
    if (!open || panel.current === null) {
      setAt((current) => stablePlacement(current, undefined))
      return undefined
    }
    const node = panel.current
    const layout = (): void => {
      const next =
        point === undefined
          ? anchor === null
            ? undefined
            : placeAtAnchor(anchor, node)
          : placeAtPoint(point, node)
      setAt((current) => stablePlacement(current, next))
    }
    layout()
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(layout)
    resize?.observe(node)
    if (anchor !== null) resize?.observe(anchor)
    window.addEventListener("resize", layout)
    window.addEventListener("scroll", layout, true)
    return () => {
      resize?.disconnect()
      window.removeEventListener("resize", layout)
      window.removeEventListener("scroll", layout, true)
    }
  }, [open, anchor, point, panel, contentKey])

  return at
}
