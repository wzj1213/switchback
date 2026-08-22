import {
  commandsOf,
  forkPeerOf,
  itemsOf,
  limitsOf,
  modelsOf,
  tasksOf,
  turnOf,
  usageOf,
} from "@omni/store"
import { stampOf } from "./stamp.js"
import { reportedChangesOf } from "./changes.js"
import { Workspace } from "./components/Workspace.js"
import { CompareScreen, EmptyScreen, SettingsScreen } from "./screens.js"
import { Review } from "./components/Review.js"
import { SidebarPane } from "./SidebarPane.js"
import { useApp } from "./useApp.js"
import { useScrollbars } from "./useScrollbars.js"

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
      {...(app.account === undefined ? {} : { account: app.account })}
      onOpenSettings={() => {
        shell.setSettingsOpen(true)
      }}
      send={app.send}
    />
  )
}

/**
 * 盖在界面上的那两块面板：设置、审核。
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
  // 审核面板。**和设置同层**：都是盖住界面的一块，Esc 关。
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
        onCopy={app.copy}
        onClose={() => {
          shell.setReviewOpen(false)
        }}
      />
    ) : null
  return { settings, review }
}

export function App(): React.JSX.Element {
  // 滚动条：平时看不见，滚动或悬停才淡进来（只在系统本来就是经典条那一档生效）
  useScrollbars()
  const app = useApp()
  const { shell, state, thread } = app

  const sidebar = <Rail app={app} />

  const { settings, review } = Layers({ app })

  if (thread === undefined) {
    return (
      <div className="shell">
        {sidebar}
        <EmptyScreen
          notices={app.notices}
          onDismiss={shell.dismiss}
          bridgeMissing={app.bridgeMissing}
        />
        {settings}
      </div>
    )
  }

  // 有血缘关系的另一个会话。没有就不显示「对比」——点了没用的按钮比没有糟
  const peer = forkPeerOf(state, thread.id)

  if (shell.comparing && peer !== undefined) {
    return (
      <div className="shell">
        {sidebar}
        <CompareScreen
          state={state}
          engines={app.engines}
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
      </div>
    )
  }

  return (
    <div className="shell">
      {sidebar}
      {/* **key 按会话隔离。** 不加的话切会话时 Composer 不重挂，
          上一个会话没发出去的草稿会留在输入框里、被发给新会话——
          顺带把工具行的展开态、diff 的展开态也按会话隔离，
          它们同样是「属于那个会话」的状态 */}
      <Workspace
        key={thread.id}
        thread={thread}
        peer={peer}
        onCompare={() => {
          shell.setComparing(true)
        }}
        rows={app.rows}
        onSelect={shell.select}
        /* **`app.items` 不是 `app.itemsOf(thread.id)`**：后者在空会话时每次
           渲染都造一个新数组，而 `Transcript` 的 memo 认引用（见 `AppApi.items`） */
        items={app.items}
        turn={turnOf(state, thread.id)}
        /* nextEngine 只是下一句的去向；真正切换前，顶部仍应显示当前原生会话的用量。 */
        usage={usageOf(state, thread.id, thread.engine)}
        tasks={tasksOf(state, thread.id)}
        /* 引擎也要传：这份清单得**正是当前这家报的**才算数，
           否则切过去之后摆的是上一家的模型（见 store 的 `modelsOf`） */
        models={modelsOf(state, thread.id, thread.engine)}
        engines={app.engines}
        pets={app.prefs.settings.pets}
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
        /* 待切换时不拿旧引擎的命令冒充目标引擎；omni 自己的命令仍由 Workspace 补上。 */
        commands={thread.nextEngine === undefined ? commandsOf(state, thread.id, thread.engine) : []}
        limits={limitsOf(state, thread.engine)}
        onNew={app.newHere}
        onRename={shell.requestRename}
        onSettings={() => {
          shell.setSettingsOpen(true)
        }}
        searchFiles={app.searchFiles}
        onReview={() => {
          shell.setReviewOpen(true)
        }}
        send={app.send}
      />
      {settings}
      {review}
    </div>
  )
}
