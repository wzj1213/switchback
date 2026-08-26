import { useMemo } from "react"
import type { Item, Lane, Thread } from "@omni/protocol"
import type { PreviewTarget, WorkbenchState } from "../workbench.js"
import { sessionFilesOf } from "../session-files.js"
import { useWorkbenchKeys, useWorkbenchOverlay } from "../use-workbench-keys.js"
import { ActivityPage } from "./ActivityPage.js"
import { FilesPage } from "./FilesPage.js"
import { DotBoxIcon, FileIcon } from "./icons-activity.js"

function ToolTab({ on, label, count, children, onClick }: {
  on: boolean
  label: string
  count: number
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`workbench__tab${on ? " workbench__tab--on" : ""}`}
      aria-pressed={on} onClick={onClick}>
      {children}<span>{label}</span>{count === 0 ? null : <span className="workbench__count">{count}</span>}
    </button>
  )
}

export function WorkbenchPane({ state, thread, lanes, items, stamp, onActivity, onFiles, onPickLane,
  onActivityIndex, onPickFile, onFileIndex, onReference, onHide, onReveal, onCopy, searchFiles }: {
  state: WorkbenchState
  thread: Thread
  lanes: readonly Lane[]
  items: readonly Item[]
  /** 轮次 / shell 完成时变化；打开的文件据此重读磁盘。 */
  stamp: string
  onActivity: () => void
  onFiles: () => void
  onPickLane: (id: string) => void
  onActivityIndex: () => void
  onPickFile: (target: PreviewTarget) => void
  onFileIndex: () => void
  onReference?: (target: PreviewTarget) => void
  onHide: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
}): React.JSX.Element | null {
  const fileCount = useMemo(() => sessionFilesOf(items, thread.cwd).length, [items, thread.cwd])
  const overlay = useWorkbenchOverlay()
  const box = useWorkbenchKeys(state, overlay, onHide)
  if (!state.visible) return null
  return (
    <aside ref={box} className="workbench" tabIndex={-1} aria-label="任务工作台"
      role={overlay ? "dialog" : undefined} aria-modal={overlay ? true : undefined}>
      <header className="workbench__head">
        <nav className="workbench__tabs" aria-label="工作台页面">
          <ToolTab on={state.page === "activity"} label="活动" count={lanes.length} onClick={onActivity}>
            <DotBoxIcon size={13} />
          </ToolTab>
          <ToolTab on={state.page === "files"} label="文件" count={fileCount} onClick={onFiles}>
            <FileIcon size={13} />
          </ToolTab>
        </nav>
        <button type="button" className="workbench__hide" aria-label="收起工作台"
          title="收起工作台" onClick={onHide}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.7" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </header>
      <div className="workbench__body">
        {state.page === "activity" ? (
          <ActivityPage lanes={lanes} laneId={state.laneId} items={items} thread={thread}
            onPick={onPickLane} onBack={onActivityIndex} onCopy={onCopy} />
        ) : (
          <FilesPage threadId={thread.id} cwd={thread.cwd} items={items} stamp={stamp}
            target={state.file} onPick={onPickFile}
            onBack={onFileIndex} onReference={onReference} referenceDisabled={thread.detached === true}
            onReveal={onReveal} onCopy={onCopy} searchFiles={searchFiles} />
        )}
      </div>
    </aside>
  )
}
