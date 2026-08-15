import { forkPeerOf, itemsOf, modelsOf, threadRowsOf, turnOf, usageOf } from "@omni/store"
import { Workspace } from "./components/Workspace.js"
import { useShell } from "./useShell.js"
import { CompareScreen, EmptyScreen, SidebarPane } from "./screens.js"
import { useOmni } from "./useOmni.js"
import { useWorkspaceActions } from "./useWorkspaceActions.js"

/** 选哪个会话、怎么新建。一个会话内部长什么样是 `Workspace` 的事。 */
export function App(): React.JSX.Element {
  const { state, send, pickFolder, onMenu, find, stopFind, copy, reveal, searchFiles, bridgeMissing } = useOmni()
  const shell = useShell()
  const rows = threadRowsOf(state)
  // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
  const notices = state.notices.filter((n) => n.id !== shell.dismissed)
  const thread = rows.find((r) => r.thread.id === shell.selectedId)?.thread ?? rows[0]?.thread

  const { open, openPicker } = useWorkspaceActions({
    state,
    thread,
    send,
    copy,
    pickFolder,
    onMenu,
    onSelect: shell.select,
    onFind: () => {
      shell.setFinding(true)
    },
    onCompare: () => {
      shell.setComparing(true)
    },
    onFilterThreads: shell.askFocusFilter,
  })

  const sidebar = (
    <SidebarPane
      rows={rows}
      thread={thread}
      focusFilter={shell.focusFilter}
      onSelect={shell.select}
      onNew={() => {
        if (thread === undefined) openPicker()
        else open(thread.cwd)
      }}
      onNewIn={open}
      onOpenFolder={openPicker}
      onReveal={reveal}
      onCopy={copy}
      send={send}
    />
  )

  if (thread === undefined) {
    return (
      <div className="shell">
        {sidebar}
        <EmptyScreen notices={notices} onDismiss={shell.dismiss} bridgeMissing={bridgeMissing} />
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
          onCopy={copy}
          onPick={(id) => {
            shell.select(id)
            shell.setComparing(false)
          }}
          onClose={() => {
            shell.setComparing(false)
          }}
          send={send}
        />
      </div>
    )
  }

  return (
    <div className="shell">
      {sidebar}
      <Workspace
        thread={thread}
        peer={peer}
        onCompare={() => {
          shell.setComparing(true)
        }}
        items={itemsOf(state, thread.id)}
        turn={turnOf(state, thread.id)}
        usage={usageOf(state, thread.id)}
        models={modelsOf(state, thread.id)}
        engines={state.engines}
        notices={notices}
        onDismiss={shell.dismiss}
        finding={shell.finding}
        onFind={find}
        onCloseFind={() => {
          shell.setFinding(false)
          stopFind()
        }}
        onCopy={copy}
        searchFiles={searchFiles}
        send={send}
      />
    </div>
  )
}
