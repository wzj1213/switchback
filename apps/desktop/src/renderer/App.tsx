import { useState } from "react"
import type { Command, Thread } from "@omni/protocol"
import type { Notice, ViewState } from "@omni/store"
import { forkPeerOf, itemsOf, modelsOf, threadRowsOf, turnOf, usageOf } from "@omni/store"
import { Sidebar } from "./components/Sidebar.js"
import { Notices } from "./components/Notices.js"
import { Workspace } from "./components/Workspace.js"
import { Compare, type ComparePane } from "./components/Compare.js"
import { useOmni } from "./useOmni.js"
import { useWorkspaceActions } from "./useWorkspaceActions.js"

/**
 * 空状态说什么。
 *
 * 有故障横幅时**不能**再说「正在打开工作区…」——那是句谎话，它永远不会打开，
 * 用户会一直等下去。一个会等到天亮的加载提示比一句直白的失败更糟。
 */
function emptyText(bridgeMissing: boolean, failed: boolean): string {
  if (bridgeMissing) {
    return "与主进程的通道没建立（preload 未注入）。界面此时点什么都不会有反应——先查主进程日志。"
  }
  if (failed) return "没有可用的会话。上方的故障说明了原因；处理好之后点「＋ 新建会话」重试。"
  return "正在打开工作区…"
}

function Notice({ text, fatal }: { text: string; fatal: boolean }): React.JSX.Element {
  return (
    <div className="transcript">
      <div className="transcript__inner">
        <div className={fatal ? "error" : "reasoning"}>{text}</div>
      </div>
    </div>
  )
}

/** 一个会话都没有时的主区。故障横幅照样要显示——那往往正是没有会话的原因。 */
function EmptyScreen({
  notices,
  onDismiss,
  bridgeMissing,
}: {
  notices: readonly Notice[]
  onDismiss: (id: string) => void
  bridgeMissing: boolean
}): React.JSX.Element {
  return (
    <main className="main">
      <Notices notices={notices} onDismiss={onDismiss} />
      <Notice fatal={bridgeMissing} text={emptyText(bridgeMissing, notices.length > 0)} />
    </main>
  )
}

/**
 * 对比屏。从 `App` 拆出来是行数闸门逼的，但拆完确实更清楚：
 * 「谁在左边」这个决定有它自己的理由，值得单独一段。
 */
function CompareScreen({
  state,
  thread,
  peer,
  onCopy,
  onPick,
  onClose,
  send,
}: {
  state: ViewState
  thread: Thread
  peer: Thread
  onCopy: (text: string) => void
  onPick: (id: string) => void
  onClose: () => void
  send: (command: Command) => void
}): React.JSX.Element {
  const paneOf = (t: Thread): ComparePane => ({
    thread: t,
    items: itemsOf(state, t.id),
    turn: turnOf(state, t.id),
  })
  // 谁在左边由**创建先后**定，不是由「当前选中的是谁」定：
  // 从两边分别点进来看到的应该是同一张图，否则「左边那栏」这句话就没法说
  const [older, newer] = thread.createdAt <= peer.createdAt ? [thread, peer] : [peer, thread]
  return (
    <Compare
      a={paneOf(older)}
      b={paneOf(newer)}
      engines={state.engines}
      onCopy={onCopy}
      onPick={onPick}
      onClose={onClose}
      send={send}
    />
  )
}

/** 选哪个会话、怎么新建。一个会话内部长什么样是 `Workspace` 的事。 */
export function App(): React.JSX.Element {
  const { state, send, pickFolder, onMenu, find, stopFind, copy, searchFiles, bridgeMissing } = useOmni()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  const [finding, setFinding] = useState(false)
  const [comparing, setComparing] = useState(false)

  const rows = threadRowsOf(state)
  // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
  const notices = state.notices.filter((n) => n.id !== dismissed)
  const thread = rows.find((r) => r.thread.id === selectedId)?.thread ?? rows[0]?.thread

  const { open, openPicker } = useWorkspaceActions({
    state,
    thread,
    send,
    copy,
    pickFolder,
    onMenu,
    onSelect: setSelectedId,
    onFind: () => {
      setFinding(true)
    },
    onCompare: () => {
      setComparing(true)
    },
  })

  const sidebar = (
    <Sidebar
      rows={rows}
      selectedId={thread?.id ?? ""}
      onSelect={setSelectedId}
      onNew={() => {
        if (thread === undefined) openPicker()
        else open(thread.cwd)
      }}
      onOpenFolder={openPicker}
      onDelete={(id) => {
        // 删的正好是当前选中的：把选择交还给「最近那个」，而不是留一个空指针
        if (id === thread?.id) setSelectedId(undefined)
        send({ type: "thread.delete", threadId: id })
      }}
    />
  )

  if (thread === undefined) {
    return (
      <div className="shell">
        {sidebar}
        <EmptyScreen notices={notices} onDismiss={setDismissed} bridgeMissing={bridgeMissing} />
      </div>
    )
  }

  // 有血缘关系的另一个会话。没有就不显示「对比」——点了没用的按钮比没有糟
  const peer = forkPeerOf(state, thread.id)

  if (comparing && peer !== undefined) {
    return (
      <div className="shell">
        {sidebar}
        <CompareScreen
          state={state}
          thread={thread}
          peer={peer}
          onCopy={copy}
          onPick={(id) => {
            setSelectedId(id)
            setComparing(false)
          }}
          onClose={() => {
            setComparing(false)
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
          setComparing(true)
        }}
        items={itemsOf(state, thread.id)}
        turn={turnOf(state, thread.id)}
        usage={usageOf(state, thread.id)}
        models={modelsOf(state, thread.id)}
        engines={state.engines}
        notices={notices}
        onDismiss={setDismissed}
        finding={finding}
        onFind={find}
        onCloseFind={() => {
          setFinding(false)
          stopFind()
        }}
        onCopy={copy}
        searchFiles={searchFiles}
        send={send}
      />
    </div>
  )
}
