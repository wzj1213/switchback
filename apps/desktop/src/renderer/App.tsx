import { forkPeerOf, modelsOf, turnOf, usageOf } from "@omni/store"
import { Workspace } from "./components/Workspace.js"
import { CompareScreen, EmptyScreen, SettingsScreen, SidebarPane } from "./screens.js"
import { useApp } from "./useApp.js"

/**
 * 选哪一屏。
 *
 * **只做这一件事。** 接线（十来个回调、当前会话是哪个、偏好）全在 `useApp` 里——
 * 混在一起的时候，「渲染哪一屏」这个真正的职责被埋在三十行 props 中间。
 */
export function App(): React.JSX.Element {
  const app = useApp()
  const { shell, prefs, state, thread } = app

  const sidebar = (
    <SidebarPane
      rows={app.rows}
      thread={thread}
      focusFilter={shell.focusFilter}
      onSelect={shell.select}
      onNew={app.newHere}
      onNewIn={app.open}
      onOpenFolder={app.openPicker}
      onReveal={app.reveal}
      onCopy={app.copy}
      pinned={prefs.settings.pinned}
      onTogglePin={prefs.togglePin}
      onOpenSettings={() => {
        shell.setSettingsOpen(true)
      }}
      send={app.send}
    />
  )

  const settings = shell.settingsOpen ? (
    <SettingsScreen
      prefs={prefs}
      engines={state.engines}
      onReveal={app.reveal}
      onCopy={app.copy}
      onClose={() => {
        shell.setSettingsOpen(false)
      }}
    />
  ) : null

  if (thread === undefined) {
    return (
      <div className="shell">
        {sidebar}
        <EmptyScreen notices={app.notices} onDismiss={shell.dismiss} bridgeMissing={app.bridgeMissing} />
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
        items={app.itemsOf(thread.id)}
        turn={turnOf(state, thread.id)}
        usage={usageOf(state, thread.id)}
        models={modelsOf(state, thread.id)}
        engines={state.engines}
        notices={app.notices}
        onDismiss={shell.dismiss}
        finding={shell.finding}
        onFind={app.find}
        onCloseFind={() => {
          shell.setFinding(false)
          app.stopFind()
        }}
        onCopy={app.copy}
        searchFiles={app.searchFiles}
        send={app.send}
      />
      {settings}
    </div>
  )
}
