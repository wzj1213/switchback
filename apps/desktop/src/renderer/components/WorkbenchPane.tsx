import type { Item, Lane, Thread } from "@omni/protocol"
import type { PreviewTarget, WorkbenchState } from "../workbench.js"
import { useWorkbenchKeys } from "../use-workbench-keys.js"
import { ActivityPage } from "./ActivityPage.js"
import { FilesPage } from "./FilesPage.js"
import type { SearchFiles } from "../use-file-search.js"
import { PanelTabs, type PanelTabsProps } from "./PanelTabs.js"

export function WorkbenchPane({ state, thread, lanes, items, stamp, onPickLane,
  onActivityIndex, onPickFile, onFileIndex, onReference, onHide, onReveal, onCopy, searchFiles,
  notice, panel }: {
  state: WorkbenchState
  thread: Thread
  lanes: readonly Lane[]
  items: readonly Item[]
  /** 轮次 / shell 完成时变化；打开的文件据此重读磁盘。 */
  stamp: string
  onPickLane: (id: string) => void
  onActivityIndex: () => void
  onPickFile: (target: PreviewTarget) => void
  onFileIndex: () => void
  onReference?: (target: PreviewTarget) => void
  onHide: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  searchFiles: SearchFiles
  notice?: string
  panel: PanelTabsProps
}): React.JSX.Element | null {
  const box = useWorkbenchKeys(state, onHide)
  return (
    <section ref={box} className="workbench" tabIndex={-1}
      aria-label="任务工作台" hidden={!state.visible}>
      <PanelTabs {...panel} onHide={onHide} />
      {notice === undefined ? null : <p className="workbench__notice" role="status">{notice}</p>}
      <div className="workbench__body">
        <div className="workbench__page" hidden={state.page !== "activity"}>
          <ActivityPage lanes={lanes} laneId={state.laneId} items={items} thread={thread}
            onPick={onPickLane} onBack={onActivityIndex} onCopy={onCopy} />
        </div>
        <div className="workbench__page" hidden={state.page !== "files"}>
          {/* 搜索上下文只属于这一条任务；切任务时重挂，页内切换或收起时保活。 */}
          <FilesPage key={`${thread.id}\u0000${thread.cwd}`} threadId={thread.id} cwd={thread.cwd}
            items={items} stamp={stamp} active={state.visible && state.page === "files"}
            target={state.file} onPick={onPickFile}
            onBack={onFileIndex} onReference={onReference} referenceDisabled={thread.detached === true}
            onReveal={onReveal} onCopy={onCopy} searchFiles={searchFiles} />
        </div>
      </div>
    </section>
  )
}
