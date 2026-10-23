import type { ReviewFile } from "../../shared/review.js"
import { FileListIcon, LinesIcon, SplitIcon } from "./icons-panel.js"
import { ReloadIcon } from "./reload-icon.js"
import { ReviewFileJump } from "./review-file-jump.js"
import { useMessages } from "../i18n.js"
import { REVIEW_TOOLS } from "./ReviewTools.messages.js"

function ToolButton({ label, on, disabled, onClick, children }: {
  label: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" className={`rv__tool${on === true ? " rv__tool--on" : ""}`}
      aria-label={label} data-tip={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

export function Tools({ split, narrow, onSplit, context, onContext, onReload, list, onList, files, active, onPick }: {
  split: boolean
  /** 面板窄到摆不下两列。**按钮置灰而不是消失**——消失了没人知道并排去哪了。 */
  narrow: boolean
  onSplit: (on: boolean) => void
  context: number
  onContext: (n: number) => void
  onReload: () => void
  list: boolean
  onList: (on: boolean) => void
  files: readonly ReviewFile[]
  active: string | undefined
  onPick: (path: string) => void
}): React.JSX.Element {
  const m = useMessages(REVIEW_TOOLS)
  const expanded = context === 9999
  return (
    <div className="rv__tools" aria-label={m.label}>
      <ToolButton label={expanded ? m.collapse : m.expand} on={expanded}
        onClick={() => { onContext(expanded ? 3 : 9999) }}><LinesIcon /></ToolButton>
      <ReviewFileJump files={files} active={active} onPick={onPick} />
      <ToolButton
        label={narrow ? m.narrow : split ? m.unified : m.split}
        on={split && !narrow} disabled={narrow}
        onClick={() => { onSplit(!split) }}><SplitIcon /></ToolButton>
      <ToolButton label={list ? m.hideFiles : m.showFiles} on={list}
        onClick={() => { onList(!list) }}><FileListIcon /></ToolButton>
      <ToolButton label={m.reload} onClick={onReload}><ReloadIcon size={14} /></ToolButton>
    </div>
  )
}
