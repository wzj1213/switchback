import { useCallback, useEffect, useRef, useState } from "react"
import { clampPanel, clampSidebar } from "../shared/pane-widths.js"

/** 哪一条拖拽柄：侧栏右缘，还是面板左缘。 */
export type PaneSide = "rail" | "panel"

/** 每一边写哪个 CSS 变量：侧栏直接盖住 tokens 里的默认宽度，面板是单独的「用户宽度」。 */
const PANE_VAR: Record<PaneSide, string> = { rail: "--sidebar-w", panel: "--panel-user" }

/** 写到根元素上；0 = 没拖过，清掉，回到样式表里的默认规则。 */
export function applyPaneWidth(side: PaneSide, width: number): void {
  const style = document.documentElement.style
  if (width > 0) style.setProperty(PANE_VAR[side], `${String(width)}px`)
  else style.removeProperty(PANE_VAR[side])
}

/**
 * 分界线挪了 `dx` 之后这一栏多宽。**方向按分界线走**：侧栏的线往右是变宽，
 * 面板的线往左是变宽。拖动与方向键共用这一个算法。
 */
export function paneWidthAt(side: PaneSide, start: number, dx: number, room: { viewport: number; rail: number }): number {
  return side === "rail" ? clampSidebar(start + dx, room.viewport) : clampPanel(start - dx, room.viewport, room.rail)
}

/** 键盘挪一格：方向键 16，按住 ⇧ 64。别的键不管。 */
export function paneKeyDelta(key: string, shift: boolean): number | undefined {
  const step = shift ? 64 : 16
  if (key === "ArrowRight") return step
  if (key === "ArrowLeft") return -step
  return undefined
}

/** 此刻三列的实际宽度（px），从外壳的计算样式里读——比各自去量元素少一次猜。 */
function columns(shell: Element | null): readonly number[] {
  if (shell === null) return [0, 0, 0]
  return getComputedStyle(shell).gridTemplateColumns.split(" ").map((track) => Number.parseFloat(track) || 0)
}

function measure(side: PaneSide, handle: Element | null): { width: number; rail: number } {
  const [rail = 0, , panel = 0] = columns(handle?.parentElement ?? null)
  return { width: side === "rail" ? rail : panel, rail }
}

interface Drag { x: number; start: number; rail: number; width: number; frame: number }

/**
 * 拖动一条分栏柄。**拖的过程中不走 React**：每一帧直接改根元素上的 CSS 变量，
 * 松手才交给 `onCommit` 落进设置——拖一下要是每个 pointermove 都重渲染整扇窗口，
 * 手是跟不上的。拖动期间在根元素上挂 `data-pane-resizing`，关掉分栏开合那条过渡。
 */
export function usePaneDrag(side: PaneSide, onCommit: (width: number) => void): {
  ref: React.RefObject<HTMLDivElement | null>
  live: boolean
  now: number
  handlers: Pick<React.HTMLAttributes<HTMLDivElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture"
    | "onDoubleClick" | "onKeyDown">
} {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | undefined>(undefined)
  const [live, setLive] = useState(false)
  const [now, setNow] = useState(0)
  useEffect(() => {
    const sync = (): void => { setNow(measure(side, ref.current).width) }
    sync()
    window.addEventListener("resize", sync)
    return () => { window.removeEventListener("resize", sync) }
  }, [side])
  const finish = useCallback((commit: boolean) => {
    const it = drag.current
    if (it === undefined) return
    drag.current = undefined
    cancelAnimationFrame(it.frame)
    delete document.documentElement.dataset["paneResizing"]
    setLive(false)
    applyPaneWidth(side, it.width)
    setNow(it.width)
    if (commit && it.width !== it.start) onCommit(it.width)
  }, [side, onCommit])
  return { ref, live, now, handlers: paneHandlers({ side, ref, drag, setLive, setNow, finish, onCommit }) }
}

/** 事件接线，从 `usePaneDrag` 拆出来：那边管状态，这边管每个事件怎么改它。 */
function paneHandlers(on: {
  side: PaneSide
  ref: React.RefObject<HTMLDivElement | null>
  drag: React.RefObject<Drag | undefined>
  setLive: (live: boolean) => void
  setNow: (width: number) => void
  finish: (commit: boolean) => void
  onCommit: (width: number) => void
}): ReturnType<typeof usePaneDrag>["handlers"] {
  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const { width, rail } = measure(on.side, on.ref.current)
      on.drag.current = { x: event.clientX, start: width, rail, width, frame: 0 }
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 合成事件没有活的指针，照样能拖 */ }
      document.documentElement.dataset["paneResizing"] = on.side
      on.setLive(true)
    },
    onPointerMove: (event) => {
      const it = on.drag.current
      if (it === undefined) return
      it.width = paneWidthAt(on.side, it.start, event.clientX - it.x, { viewport: window.innerWidth, rail: it.rail })
      if (it.frame !== 0) return
      it.frame = requestAnimationFrame(() => {
        it.frame = 0
        applyPaneWidth(on.side, it.width)
      })
    },
    onPointerUp: () => { on.finish(true) },
    onPointerCancel: () => { on.finish(true) },
    // 窗口失焦之类收不到 pointerup 的情形：捕获一丢就当松手，不留一个悬着的拖动
    onLostPointerCapture: () => { on.finish(true) },
    // 双击回到默认：清掉拖出来的宽度，跟着窗口走
    onDoubleClick: () => {
      applyPaneWidth(on.side, 0)
      on.setNow(measure(on.side, on.ref.current).width)
      on.onCommit(0)
    },
    onKeyDown: (event) => {
      const dx = paneKeyDelta(event.key, event.shiftKey)
      if (dx === undefined) return
      event.preventDefault()
      const { width, rail } = measure(on.side, on.ref.current)
      const next = paneWidthAt(on.side, width, dx, { viewport: window.innerWidth, rail })
      applyPaneWidth(on.side, next)
      on.setNow(next)
      on.onCommit(next)
    },
  }
}
