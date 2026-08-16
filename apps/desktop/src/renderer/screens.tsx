import { useEffect, useState } from "react"
import type { Command, EngineInfo, Thread } from "@omni/protocol"
import { itemsOf, turnOf, type Notice as StoreNotice, type ThreadRow, type ViewState } from "@omni/store"
import { Sidebar } from "./components/Sidebar.js"
import { Notices } from "./components/Notices.js"
import { Compare, type ComparePane } from "./components/Compare.js"
import { SettingsPanel } from "./components/SettingsPanel.js"
import type { SettingsApi } from "./useSettings.js"

/**
 * 除主区之外的几块屏。
 *
 * 从 `App` 拆出来是行数闸门逼的，但边界是对的：`App` 只管**在哪几块之间切**，
 * 每一块自己长什么样是这里的事。
 */

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
export function EmptyScreen({
  notices,
  onDismiss,
  bridgeMissing,
}: {
  notices: readonly StoreNotice[]
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

/** 侧栏接线。从 `App` 拆出来是行数闸门逼的，但它确实自成一块。 */
export function SidebarPane({
  rows,
  thread,
  focusFilter,
  askRename,
  onNewChat,
  onSelect,
  onNew,
  onNewIn,
  onOpenFolder,
  onReveal,
  onCopy,
  pinned,
  icons,
  onSetIcon,
  onTogglePin,
  onOpenSettings,
  send,
}: {
  rows: readonly ThreadRow[]
  thread: Thread | undefined
  focusFilter: number
  askRename: number
  onNewChat: () => void
  onSelect: (id: string | undefined) => void
  onNew: () => void
  onNewIn: (cwd: string) => void
  onOpenFolder: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  pinned: readonly string[]
  icons: Readonly<Record<string, string>>
  onSetIcon: (cwd: string, icon: string) => void
  onTogglePin: (cwd: string) => void
  onOpenSettings: () => void
  send: (command: Command) => void
}): React.JSX.Element {
  return (
    <Sidebar
      rows={rows}
      selectedId={thread?.id ?? ""}
      onSelect={onSelect}
      onNew={onNew}
      onOpenFolder={onOpenFolder}
      onNewIn={onNewIn}
      onReveal={onReveal}
      onCopy={onCopy}
      pinned={pinned}
      icons={icons}
      onSetIcon={onSetIcon}
      onTogglePin={onTogglePin}
      onOpenSettings={onOpenSettings}
      focusFilter={focusFilter}
      askRename={askRename}
      onNewChat={onNewChat}
      onDelete={(id: string) => {
        // 删的正好是当前选中的：把选择交还给「最近那个」，而不是留一个空指针
        if (id === thread?.id) onSelect(undefined)
        send({ type: "thread.delete", threadId: id })
      }}
      onRename={(id: string, title: string) => {
        send({ type: "thread.rename", threadId: id, title })
      }}
    />
  )
}

/**
 * 对比屏。从 `App` 拆出来是行数闸门逼的，但拆完确实更清楚：
 * 「谁在左边」这个决定有它自己的理由，值得单独一段。
 */
export function CompareScreen({
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


/**
 * 设置屏。把「版本/数据目录」这两样异步拿到的东西留在这里，
 * 不塞进 `App`——它们只有这块面板用得着。
 */
export function SettingsScreen({
  prefs,
  engines,
  onReveal,
  onCopy,
  onClose,
}: {
  prefs: SettingsApi
  engines: readonly EngineInfo[]
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState({ version: "", dataDir: "" })
  const bridge = typeof window === "undefined" ? undefined : window.omni
  useEffect(() => {
    if (bridge === undefined) return
    void bridge.appInfo().then(setInfo)
  }, [bridge])
  return (
    <SettingsPanel
      settings={prefs.settings}
      engines={engines}
      version={info.version}
      dataDir={info.dataDir}
      onPatch={prefs.patch}
      onClose={onClose}
      onReveal={onReveal}
      onCopy={onCopy}
      onOpenEngines={() => {
        bridge?.openEngines()
      }}
      onDiagnose={() => {
        bridge?.diagnose()
      }}
    />
  )
}
