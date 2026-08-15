import { useEffect, useRef } from "react"
import { itemsOf, threadRowsOf, type Notice, type ThreadRow, type ViewState } from "@omni/store"
import type { Item } from "@omni/protocol"
import type { Command, Thread } from "@omni/protocol"
import { useOmni } from "./useOmni.js"
import { useSettings, type SettingsApi } from "./useSettings.js"
import { useShell, type Shell } from "./useShell.js"
import { useWorkspaceActions } from "./useWorkspaceActions.js"

/**
 * 把 `App` 需要的一切收在一处。
 *
 * `App` 原来直接串了十个回调，于是它同时在做两件事：**接线**和**决定渲染哪一屏**。
 * 接线那部分每加一个功能就长几行，把「渲染哪一屏」这个真正的职责埋在中间。
 *
 * 现在这里只管接线，`App` 只管选屏。
 */
export interface AppApi {
  state: ViewState
  rows: readonly ThreadRow[]
  /** 当前选中的会话；一个都没有时是 undefined。 */
  thread: Thread | undefined
  notices: readonly Notice[]
  shell: Shell
  prefs: SettingsApi
  bridgeMissing: boolean
  send: (command: Command) => void
  copy: (text: string) => void
  reveal: (path: string) => void
  find: (query: string, next: boolean, forward: boolean) => Promise<{ active: number; total: number }>
  stopFind: () => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /** 在指定目录开新会话。 */
  open: (cwd: string) => void
  /** 弹目录框再开。 */
  openPicker: () => void
  /** 侧栏「新建会话」：有当前会话就用它的目录，没有就先问路径。 */
  newHere: () => void
  itemsOf: (threadId: string) => readonly Item[]
}

export function useApp(): AppApi {
  const omni = useOmni()
  const shell = useShell()
  const prefs = useSettings()

  const rows = threadRowsOf(omni.state)
  /**
   * 新建之后跳到新会话上。
   *
   * 点「新建」的那一刻还没有 id——会话是宿主起好之后才回来的。
   * 所以这里立一个「在等」的旗子，等增量里那条 `thread.started` 到了再选它。
   *
   * 上一版是「把选中清空，让排序把新的顶到第一位」——**靠排序碰运气**，
   * 而且没有任何东西钉住这个巧合：一旦排序规则变了（置顶、分组、最近段），
   * 点新建就跳到别的会话上，还不报错。
   */
  const waiting = useRef(false)
  useEffect(() => {
    if (!waiting.current || omni.lastStarted === undefined) return
    waiting.current = false
    shell.select(omni.lastStarted)
  }, [omni.lastStarted, shell])
  // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
  const notices = omni.state.notices.filter((n) => !shell.dismissed.has(n.id))
  const thread = rows.find((r) => r.thread.id === shell.selectedId)?.thread ?? rows[0]?.thread

  const { open, openPicker } = useWorkspaceActions({
    state: omni.state,
    thread,
    send: omni.send,
    copy: omni.copy,
    pickFolder: omni.pickFolder,
    onMenu: omni.onMenu,
    onSelect: (id) => {
      // `open()` 用 `undefined` 表示「我刚发了新建，等它回来」
      if (id === undefined) waiting.current = true
      shell.select(id)
    },
    defaultEngine: prefs.settings.defaultEngine,
    defaultTrust: prefs.settings.defaultTrust,
    onFind: () => {
      shell.setFinding(true)
    },
    onCompare: () => {
      shell.setComparing(true)
    },
    onFilterThreads: shell.askFocusFilter,
    onSettings: () => {
      shell.setSettingsOpen(true)
    },
  })

  return {
    state: omni.state,
    rows,
    thread,
    notices,
    shell,
    prefs,
    bridgeMissing: omni.bridgeMissing,
    send: omni.send,
    copy: omni.copy,
    reveal: omni.reveal,
    find: omni.find,
    stopFind: omni.stopFind,
    searchFiles: omni.searchFiles,
    open,
    openPicker,
    newHere: () => {
      if (thread === undefined) openPicker()
      else open(thread.cwd)
    },
    itemsOf: (threadId) => itemsOf(omni.state, threadId),
  }
}
