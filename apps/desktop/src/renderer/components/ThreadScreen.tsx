import type { EngineInfo, Thread } from "@switchback/protocol"
import {
  commandsOf,
  itemsOf,
  lanesOf,
  limitsOf,
  modelsOf,
  pacesOf,
  reconnectingOf,
  tasksOf,
  thinkingTokensOf,
  turnOf,
  usageOf,
} from "@switchback/store"
import type { useApp } from "../useApp.js"
import { scopeWorkbench } from "../workbench.js"
import { Workspace } from "./Workspace.js"
import type { ComposerDrafts } from "../composer-drafts.js"
import { stampOf } from "../stamp.js"
import { ThreadWorkbench } from "./thread-workbench.js"
import { panelShellClass } from "../panel-layout.js"
import { useComposerReference } from "../use-composer-reference.js"

/** 当前任务的一整屏接线；App 只负责在空白页、对比页与这里之间选路。 */
export function ThreadScreen({
  app,
  thread,
  peer,
  engines,
  sidebar,
  layers,
  drafts,
}: {
  app: ReturnType<typeof useApp>
  thread: Thread
  peer: Thread | undefined
  engines: readonly EngineInfo[]
  sidebar: React.ReactNode
  layers: React.ReactNode
  drafts: ComposerDrafts
}): React.JSX.Element {
  const { shell, state } = app
  // 「把这条路径填进输入框」：文件工作台点「引用」、`/承接上一段`、⇧⌘E 都进这一个格子
  const { reference, set: setReference } = useComposerReference()
  const lanes = lanesOf(state, thread.id)
  const allItems = itemsOf(state, thread.id)
  const turn = turnOf(state, thread.id)
  // 预览也要跟着磁盘可能变化的节拍走；旁路 shell 同样可能改当前文件，
  // 所以这里用包含 lane 的 allItems，而主转录区仍拿自己过滤后的 app.items。
  const fileStamp = stampOf(turn, allItems)
  const workbench = scopeWorkbench(
    shell.workbench,
    new Set(lanes.map((lane) => lane.id)),
    thread.id,
    thread.cwd,
  )
  return (
    <div className={panelShellClass(shell.panelVisible, shell.panelFull, shell.railOpen)}>
      {sidebar}
      <Workspace
        key={thread.id}
        drafts={drafts}
        composerReference={reference?.threadId === thread.id ? reference : undefined}
        thread={thread}
        peer={peer}
        onCompare={() => { shell.setComparing(true) }}
        rows={app.rows}
        onSelect={shell.select}
        items={app.items}
        turn={turn}
        usage={usageOf(state, thread.id, thread.engine)}
        tasks={tasksOf(state, thread.id)}
        thinkingTokens={thinkingTokensOf(state, thread.id)}
        paces={pacesOf(state, thread.id)}
        reconnecting={reconnectingOf(state, thread.id)}
        lanes={lanes}
        openLane={workbench.visible && workbench.page === "activity" ? workbench.laneId : undefined}
        onOpenLane={shell.openAside}
        panelVisible={shell.panelVisible}
        railOpen={shell.railOpen}
        onRail={shell.toggleRail}
        dropSurfaceVisible={shell.panelVisible}
        onTogglePanel={shell.togglePanelVisibility}
        onFilesDropped={() => {
          if (shell.panelFull) shell.hideWorkbench()
        }}
        models={modelsOf(state, thread.id, thread.engine)}
        engines={engines}
        pets={{ on: app.prefs.settings.pets, ...app.prefs.settings.petKit }}
        notices={app.notices}
        onDismiss={shell.dismiss}
        onLogin={() => { shell.openSettingsAt("install") }}
        finding={shell.finding}
        onFind={app.find}
        onCloseFind={() => { shell.setFinding(false); app.stopFind() }}
        onCopy={app.copy}
        onReveal={app.reveal}
        commands={
          thread.nextEngine === undefined ? commandsOf(state, thread.id, thread.engine) : []
        }
        limits={limitsOf(state, thread.engine)}
        onNew={app.newHere}
        onRename={shell.requestRename}
        onSettings={() => { shell.setSettingsOpen(true) }}
        searchFiles={app.searchFiles}
        onReview={() => { shell.setReviewOpen(true) }}
        send={app.send}
      />
      <ThreadWorkbench
        app={app}
        state={workbench}
        thread={thread}
        lanes={lanes}
        items={allItems}
        stamp={fileStamp}
        drafts={drafts}
        setReference={setReference}
        full={shell.panelFull}
        onFull={shell.togglePanelFull}
      />
      {layers}
    </div>
  )
}
