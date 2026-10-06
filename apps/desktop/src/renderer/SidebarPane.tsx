import type { Command, EngineInfo, EngineThread, Thread } from "@switchback/protocol"
import { Sidebar } from "./components/Sidebar.js"
import type { SidebarRow } from "./sidebar.js"
import type { AccountLine } from "./components/SidebarFoot.js"
import { MinuteProvider } from "./useMinute.js"

interface SidebarPaneProps {
  rows: readonly SidebarRow[]
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
  /** 打开过的项目。 */
  knownProjects: readonly string[]
  onDropProject: (cwd: string) => void
  /** 已置顶的会话 id。 */
  pinnedThreads: readonly string[]
  /** 各项目内会话的手动顺序。 */
  threadOrder: Readonly<Record<string, readonly string[]>>
  onReorder: (cwd: string, ids: readonly string[]) => void
  /** 项目之间的手动顺序。 */
  projectOrder: readonly string[]
  onReorderProjects: (order: readonly string[]) => void
  onReorderPinnedProjects: (order: readonly string[]) => void
  onReorderPinnedThreads: (order: readonly string[]) => void
  onPinThread: (id: string, pin: boolean) => void
  icons: Readonly<Record<string, string>>
  onSetIcon: (cwd: string, icon: string) => void
  onTogglePin: (cwd: string) => void
  onOpenSettings: () => void
  /** 报过历史的每一家，各一段。 */
  foreign: readonly { engine: string; threads: readonly EngineThread[] }[]
  onAdopt: (engine: string, item: EngineThread) => void
  /** 引擎清单：行的悬停卡要把 engine id 翻成人话。 */
  engines: readonly EngineInfo[]
  /** 底部那一行：登录的是谁、还剩多少额度。 */
  account?: AccountLine
  send: (command: Command) => void
}

/** 侧栏接线。从 `App` 拆出来是行数闸门逼的，但它确实自成一块。 */
export function SidebarPane(props: SidebarPaneProps): React.JSX.Element {
  const { thread, onSelect, send, ...sidebar } = props
  return (
    <MinuteProvider>
      <Sidebar
        {...sidebar}
        selectedId={thread?.id ?? ""}
        onSelect={onSelect}
        onDelete={(id: string) => {
          // 删的正好是当前选中的：把选择交还给「最近那个」，而不是留一个空指针
          if (id === thread?.id) onSelect(undefined)
          send({ type: "thread.delete", threadId: id })
        }}
        onRename={(id: string, title: string) => {
          send({ type: "thread.rename", threadId: id, title })
        }}
      />
    </MinuteProvider>
  )
}

/**
 * 对比屏。从 `App` 拆出来是行数闸门逼的，但拆完确实更清楚：
 * 「谁在左边」这个决定有它自己的理由，值得单独一段。
 */
