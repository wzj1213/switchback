import { useEffect } from "react"
import { PANEL_MAX, PANEL_MIN, SIDEBAR_MAX, SIDEBAR_MIN, type PaneWidths } from "../../shared/pane-widths.js"
import { applyPaneWidth, usePaneDrag, type PaneSide } from "../use-pane-drag.js"
import { useMessages } from "../i18n.js"
import { PANE_HANDLES } from "./pane-handles.messages.js"

const LIMITS: Record<PaneSide, readonly [number, number]> = {
  rail: [SIDEBAR_MIN, SIDEBAR_MAX],
  panel: [PANEL_MIN, PANEL_MAX],
}


function PaneHandle({ side, onCommit }: { side: PaneSide; onCommit: (width: number) => void }): React.JSX.Element {
  const drag = usePaneDrag(side, onCommit)
  const m = useMessages(PANE_HANDLES)
  const [min, max] = LIMITS[side]
  return (
    <div
      ref={drag.ref}
      className={`pane-handle pane-handle--${side}${drag.live ? " pane-handle--live" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={m.label[side]}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(drag.now, min), max)}
      tabIndex={0}
      {...drag.handlers}
    />
  )
}

/**
 * 侧栏右缘、面板左缘那两条拖拽柄；顺带把设置里的宽度写到根元素上。
 *
 * 每一种外壳（空白页、对比、会话）都挂一份，作为 `.shell` 的直接子节点——
 * 位置、显隐全交给 CSS（`pane-handles.css`）：那一栏收起或独占时柄自己消失。
 */
export function PaneHandles({ panes, onChange }: {
  panes: PaneWidths
  onChange: (next: PaneWidths) => void
}): React.JSX.Element {
  useEffect(() => { applyPaneWidth("rail", panes.sidebar) }, [panes.sidebar])
  useEffect(() => { applyPaneWidth("panel", panes.panel) }, [panes.panel])
  return (
    <>
      <PaneHandle side="rail" onCommit={(sidebar) => { onChange({ ...panes, sidebar }) }} />
      <PaneHandle side="panel" onCommit={(panel) => { onChange({ ...panes, panel }) }} />
    </>
  )
}
