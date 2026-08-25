import type { EngineInfo, Thread } from "@omni/protocol"
import {
  commandsOf,
  itemsOf,
  lanesOf,
  limitsOf,
  modelsOf,
  tasksOf,
  thinkingTokensOf,
  turnOf,
  usageOf,
} from "@omni/store"
import type { useApp } from "../useApp.js"
import { scopeWorkbench } from "../workbench.js"
import { WorkbenchPane } from "./WorkbenchPane.js"
import { Workspace } from "./Workspace.js"

/** 当前任务的一整屏接线；App 只负责在空白页、对比页与这里之间选路。 */
export function ThreadScreen({
  app,
  thread,
  peer,
  engines,
  sidebar,
  layers,
}: {
  app: ReturnType<typeof useApp>
  thread: Thread
  peer: Thread | undefined
  engines: readonly EngineInfo[]
  sidebar: React.ReactNode
  layers: React.ReactNode
}): React.JSX.Element {
  const { shell, state } = app
  const lanes = lanesOf(state, thread.id)
  const allItems = itemsOf(state, thread.id)
  const workbench = scopeWorkbench(shell.workbench, new Set(lanes.map((lane) => lane.id)), thread.cwd)
  return (
    <div className={`shell${workbench.visible ? " shell--workbench" : ""}`}>
      {sidebar}
      <Workspace
        key={thread.id}
        thread={thread}
        peer={peer}
        onCompare={() => { shell.setComparing(true) }}
        rows={app.rows}
        onSelect={shell.select}
        items={app.items}
        turn={turnOf(state, thread.id)}
        usage={usageOf(state, thread.id, thread.engine)}
        tasks={tasksOf(state, thread.id)}
        thinkingTokens={thinkingTokensOf(state, thread.id)}
        lanes={lanes}
        openLane={workbench.visible && workbench.page === "activity" ? workbench.laneId : undefined}
        onOpenLane={shell.openAside}
        workbenchPage={workbench.page}
        workbenchVisible={workbench.visible}
        onOpenActivity={shell.openActivity}
        onOpenFiles={shell.openFiles}
        models={modelsOf(state, thread.id, thread.engine)}
        engines={engines}
        pets={{ on: app.prefs.settings.pets, ...app.prefs.settings.petKit }}
        notices={app.notices}
        onDismiss={shell.dismiss}
        finding={shell.finding}
        onFind={app.find}
        onCloseFind={() => {
          shell.setFinding(false)
          app.stopFind()
        }}
        onCopy={app.copy}
        onReveal={app.reveal}
        commands={thread.nextEngine === undefined ? commandsOf(state, thread.id, thread.engine) : []}
        limits={limitsOf(state, thread.engine)}
        onNew={app.newHere}
        onRename={shell.requestRename}
        onSettings={() => { shell.setSettingsOpen(true) }}
        searchFiles={app.searchFiles}
        onReview={() => { shell.setReviewOpen(true) }}
        send={app.send}
      />
      <WorkbenchPane
        state={workbench}
        thread={thread}
        lanes={lanes}
        items={allItems}
        onActivity={shell.openActivity}
        onFiles={shell.openFiles}
        onPickLane={shell.openAside}
        onActivityIndex={shell.activityIndex}
        onPickFile={shell.openFile}
        onFileIndex={shell.fileIndex}
        onHide={shell.hideWorkbench}
        onReveal={app.reveal}
        onCopy={app.copy}
        searchFiles={app.searchFiles}
      />
      {layers}
    </div>
  )
}
