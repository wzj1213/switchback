import {
  forkPeerOf,
  itemsOf,
  turnOf,
} from "@omni/store"
import { stampOf } from "./stamp.js"
import { reportedChangesOf } from "./changes.js"
import { CompareScreen, EmptyScreen, SettingsScreen } from "./screens.js"
import { Review } from "./components/Review.js"
import { ThreadScreen } from "./components/ThreadScreen.js"
import { SidebarPane } from "./SidebarPane.js"
import { TipLayer } from "./components/tips.js"
import { useApp } from "./useApp.js"
import { useWindowChrome } from "./use-window-chrome.js"
import { withThreadEngines } from "./engines.js"
import { useMemo } from "react"
import { createComposerDrafts } from "./composer-drafts.js"
import { panelShellClass } from "./panel-layout.js"

/**
 * 选哪一屏。
 *
 * **只做这一件事。** 接线（十来个回调、当前会话是哪个、偏好）全在 `useApp` 里——
 * 混在一起的时候，「渲染哪一屏」这个真正的职责被埋在三十行 props 中间。
 */
/**
 * 侧栏那一块的接线。
 *
 * 从 `App` 拆出来是行数闸门逼的，但边界是对的：`App` 只该回答
 * 「渲染哪一屏」，而这十几个回调回答的是「侧栏能干什么」。
 */
function Rail({ app }: { app: ReturnType<typeof useApp> }): React.JSX.Element {
  const { shell, prefs, thread } = app
  return (
    <SidebarPane
      // **临时会话不在这份里**：点一下「+」就多一行是错的（见 `AppApi.sidebarRows`）
      rows={app.sidebarRows}
      thread={thread}
      focusFilter={shell.focusFilter}
      askRename={shell.askRename}
      onNewChat={app.openChat}
      onSelect={shell.select}
      onNew={app.newHere}
      onNewIn={app.open}
      onOpenFolder={app.openPicker}
      onReveal={app.reveal}
      onCopy={app.copy}
      pinned={prefs.settings.pinned}
      icons={prefs.settings.projectIcons}
      onSetIcon={prefs.setIcon}
      onTogglePin={prefs.togglePin}
      knownProjects={prefs.settings.projects}
      onDropProject={prefs.dropProject}
      pinnedThreads={prefs.settings.pinnedThreads}
      threadOrder={prefs.settings.threadOrder}
      projectOrder={prefs.settings.projectOrder}
      onReorder={prefs.setOrder}
      onReorderProjects={prefs.setProjectOrder}
      onReorderPinnedProjects={prefs.setPinnedProjects}
      onReorderPinnedThreads={prefs.setPinnedThreads}
      onPinThread={prefs.pinThread}
      foreign={app.foreign}
      onAdopt={app.adopt}
      engines={app.engines}
      {...(app.account === undefined ? {} : { account: app.account })}
      onOpenSettings={() => {
        shell.setSettingsOpen(true)
      }}
      send={app.send}
    />
  )
}

/**
 * 设置浮在界面上；审核占右侧编辑器组。
 *
 * 它们和「渲染哪一屏」是两件事——三条 return 路径里每一条都要带上它们，
 * 所以算一次、三处共用。**不是组件而是取值函数**：写成组件的话
 * 每条 return 里都要多一层，而它俩本来就各自决定自己出不出现。
 */
function Layers({ app }: { app: ReturnType<typeof useApp> }): {
  settings: React.JSX.Element | null
  review: React.JSX.Element | null
} {
  const { shell, prefs, state, thread } = app
  const settings = shell.settingsOpen ? (
    <SettingsScreen
      prefs={prefs}
      engines={app.engines}
      state={state}
      cwd={thread?.cwd}
      onReveal={app.reveal}
      onCopy={app.copy}
      onClose={() => {
        shell.setSettingsOpen(false)
      }}
    />
  ) : null
  // 审核与设置共用渲染出口，但审核是外壳里的编辑器组，不是遮罩层；Esc 仍可关。
  // 没有会话时不给——它审的是「这条会话的工作区」，没有会话就没有那个目录
  const review =
    shell.reviewOpen && thread !== undefined ? (
      <Review
        /* 切任务时整块重挂：筛选词、选中文件和上一任务的缓存都不能跨任务短暂露出来。 */
        key={thread.id}
        cwd={thread.cwd}
        threadId={thread.id}
        stamp={stampOf(turnOf(state, thread.id), itemsOf(state, thread.id))}
        wanted={reportedChangesOf(itemsOf(state, thread.id), thread.cwd).list.map((file) => file.path)}
        panelActive={shell.reviewActive}
        focus={shell.reviewFocus}
        panel={{
          tabs: shell.panelTabs,
          active: shell.panelActive,
          full: shell.panelFull,
          onSelect: shell.openPanelPage,
          onClose: shell.closePanelPage,
          onFull: shell.togglePanelFull,
          onHide: shell.hideWorkbench,
        }}
        onCopy={app.copy}
        onClose={() => {
          shell.setReviewOpen(false)
        }}
      />
    ) : null
  return { settings, review }
}

export function App(): React.JSX.Element {
  useWindowChrome()
  const drafts = useMemo(createComposerDrafts, [])
  const app = useApp()
  const { shell, state, thread } = app

  const sidebar = <Rail app={app} />

  const { settings, review } = Layers({ app })
  // 悬停提示是**一层**，不是每颗按钮各挂一个（见 `components/tips.tsx`）。
  // 三条分支都要有它，所以跟着 settings / review 那一层一起走
  const tips = <TipLayer />

  if (thread === undefined) {
    return (
      <div className={panelShellClass(false, false, shell.railOpen)}>
        {sidebar}
        {tips}
        <EmptyScreen
          notices={app.notices}
          onDismiss={shell.dismiss}
          bridgeMissing={app.bridgeMissing}
          ready={app.ready}
        />
        {settings}
        {tips}
      </div>
    )
  }

  // 有血缘关系的另一个会话。没有就不显示「对比」——点了没用的按钮比没有糟
  const peer = forkPeerOf(state, thread.id)
  const workspaceEngines = withThreadEngines(app.engines, peer === undefined ? [thread] : [thread, peer])

  if (shell.comparing && peer !== undefined) {
    return (
      <div className={panelShellClass(shell.panelVisible, shell.panelFull, shell.railOpen)}>
        {sidebar}
        <CompareScreen
          state={state}
          engines={workspaceEngines}
          thread={thread}
          peer={peer}
          onCopy={app.copy}
          onPick={(id) => {
            shell.select(id)
            shell.setComparing(false)
          }}
          onClose={() => {
            shell.setComparing(false)
          }}
          send={app.send}
        />
        {settings}
        {review}
        {tips}
      </div>
    )
  }

  return (
    <ThreadScreen
      app={app}
      drafts={drafts}
      thread={thread}
      peer={peer}
      engines={workspaceEngines}
      sidebar={sidebar}
      layers={<>{settings}{review}{tips}</>}
    />
  )
}
