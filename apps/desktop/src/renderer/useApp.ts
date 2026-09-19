import { useEffect, useMemo, useRef } from "react"
import {
  accountOf,
  foreignByEngine,
  itemsOf,
  mainItems,
  limitsOf,
  threadRowsOf,
  type Notice,
  type ThreadRow,
  type ViewState,
} from "@omni/store"
import type { Item } from "@omni/protocol"
import type { Command, EngineThread, RateLimits, Thread } from "@omni/protocol"
import { useOmni } from "./useOmni.js"
import { useSettings, type SettingsApi } from "./useSettings.js"
import { useShell, type Shell } from "./useShell.js"
import type { AccountLine } from "./components/SidebarFoot.js"
import { useWorkspaceActions } from "./useWorkspaceActions.js"
import { openWithEngines } from "./newThreadPrefs.js"
import { useSend } from "./useSend.js"
import { useUnread } from "./useUnread.js"
import type { SidebarRow } from "./sidebar.js"
import { enabledEngines } from "../shared/engine-access.js"

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
  /** 设置允许出现在新会话、换引擎与远程端里的引擎。 */
  engines: ViewState["engines"]
  /** 全部会话，**含临时的**。选中判定、当前会话都从这份里找。 */
  rows: readonly ThreadRow[]
  /**
   * 侧栏那份：**临时会话不在里面**。
   *
   * 点一下「+」（以及 omni 启动时自动开的那条）先给的是一个**临时窗口**：
   * 引擎已经起好了、模型和斜杠命令都能用，但侧栏里没有它——
   * 发出第一句话它才正式出现（见 `Thread.provisional`）。
   *
   * 不这么做的话，你以为自己只是点开看看，结果攒出一串「新会话」还得一条条删；
   * 而每次启动都自动开一条，跑一周下来侧栏那一列全是空壳。
   *
   * 判据由宿主给（`provisional`），不在这里猜——猜的话（比如「没有 item 就算临时」）
   * 会把跨引擎分叉出来的空会话一起藏掉。
   *
   * 每一行还带着「它在你没看的时候跑完了没有」（`useUnread`）。**认的是
   * `thread?.id` 而不是 `shell.selectedId`**：没手动选过的时候界面显示的是最近那条，
   * 那条才是「你正看着的」。
   */
  sidebarRows: readonly SidebarRow[]
  /** 当前选中的会话；一个都没有时是 undefined。 */
  thread: Thread | undefined
  notices: readonly Notice[]
  shell: Shell
  prefs: SettingsApi
  bridgeMissing: boolean
  /** 主进程的全量到了没有。见 `useOmni` 的同名字段。 */
  ready: boolean
  send: (command: Command) => void
  copy: (text: string) => Promise<boolean>
  reveal: (path: string) => void
  find: (
    query: string,
    next: boolean,
    forward: boolean,
  ) => Promise<{ active: number; total: number }>
  stopFind: () => void
  searchFiles: (cwd: string, query: string, refresh?: boolean) => Promise<readonly string[]>
  /** 在指定目录开新会话。 */
  open: (cwd: string) => void
  /** 弹目录框再开。 */
  openPicker: () => void
  /** 开一条不属于任何项目的对话。 */
  openChat: () => void
  /** 侧栏「新建会话」：有当前会话就用它的目录，没有就先问路径。 */
  newHere: () => void
  itemsOf: (threadId: string) => readonly Item[]
  /**
   * 当前会话的条目。**和 `itemsOf(thread.id)` 的区别只有一个：引用稳定。**
   *
   * `itemsOf` 在没有条目时回的是现造的 `[]`，每次渲染都是新的一个——
   * 而 `Transcript` 的 memo 认引用。空会话正是最常打开设置的那一刻（刚开一条新的），
   * 所以这一处不能将就。
   */
  items: readonly Item[]
  /** 报过历史的每一家，各一段。 */
  foreign: readonly { engine: string; threads: readonly EngineThread[] }[]
  /** 把某一家那边的一条会话接过来，接完跳过去。 */
  adopt: (engine: string, item: EngineThread) => void
  /** 底部那一行：登录的是谁、还剩多少额度。 */
  account: AccountLine | undefined
}

/** 没有会话时那份空条目。**同一个引用**，理由见 `AppApi.items`。 */
/**
 * 只改「界面现在是什么模式」的那几个意图。
 *
 * 抽出来是函数行数闸门逼的，但边界也顺：它们**一个都不碰会话状态**，
 * 全部落在 `useShell` 上——和上面那批（新建会话、打开文件夹、中断）
 * 完全是两类东西。
 */
function viewActions(shell: Shell): Pick<
  Parameters<typeof useWorkspaceActions>[0],
  "onFind" | "onCompare" | "onReview" | "onFilterThreads" | "onToggleRail" | "onTogglePanel" | "onSettings"
> {
  return {
    onFind: () => { shell.setFinding(true) },
    onCompare: () => { shell.setComparing(true) },
    onReview: () => { shell.setReviewOpen(true) },
    onFilterThreads: shell.askFocusFilter,
    onToggleRail: shell.toggleRail,
    onTogglePanel: shell.togglePanelVisibility,
    onSettings: () => { shell.setSettingsOpen(true) },
  }
}

const EMPTY_ITEMS: readonly Item[] = []

export function useApp(): AppApi {
  const omni = useOmni()
  const shell = useShell()
  const prefs = useSettings()
  const engines = useEnabledEngines(prefs.settings, omni.state.engines)

  const rows = useMemo(() => threadRowsOf(omni.state), [omni.state.threads, omni.state.items])
  /**
   * 新建之后跳到新会话上。
   *
   * 点「新建」的那一刻还没有 id——会话是宿主起好之后才回来的。
   * 所以这里立一个「在等」的旗子，等增量里那条 `thread.started` 到了再选它。
   *
   * 上一版是「把选中清空，让排序把新的顶到第一位」——**靠排序碰运气**，
   * 而且没有任何东西钉住这个巧合：一旦排序规则变了（置顶、分组、最近段），
   * 点新建就跳到别的会话上，还不报错。
   *
   * ## 为什么记的是「点击那一刻的序号」，不是一个布尔旗子
   *
   * 旗子那版有两个洞，第二次点新建就会跳回上一个会话：
   *
   * 1. **旗子被别人立**：`onSelect(undefined)` 这个信号被两件事共用——
   *    「我刚发了新建」和「删掉了当前会话，清空选择」。删一个会话之后，
   *    下一个冒出来的会话就被当成「我等的那个」。
   * 2. **旗子被提前消费**：effect 的依赖里有 `shell`，而它每次渲染都是新对象，
   *    于是每帧重跑；只要在「点新建」和「started 到达」之间有任何一次重渲染
   *    （流式增量、横幅、改名都算），旗子就被**上一个** `lastStarted` 吃掉了。
   *    冷启动那次 `lastStarted` 是 undefined，所以第一次总是对的——
   *    这就是当初手测一次没发现它的原因。
   *
   * 记序号就没有这两个问题：等的是「序号比我点的时候大」，
   * 谁立的、中间重渲染多少次都不影响。
   */
  const awaited = useRef<number | undefined>(undefined)
  useEffect(() => {
    const at = awaited.current
    const started = omni.lastStarted
    if (at === undefined || started === undefined || started.seq <= at) return
    awaited.current = undefined
    shell.select(started.id)
  }, [omni.lastStarted, shell])
  const thread = rows.find((r) => r.thread.id === shell.selectedId)?.thread ?? rows[0]?.thread
  useEffect(() => omni.viewing(thread?.id), [omni.viewing, thread?.id])
  const items = useThreadItems(omni.state, thread)
  const visibleRows = useMemo(() => rows.filter((r) => r.thread.provisional !== true), [rows])
  const sidebarRows = useUnread(visibleRows, thread?.id)

  // 出口收在 `useSend` 里：它必须引用稳定，而**那条约束不属于「接线」这件事**——
  // 理由（以及它曾经怎么静默地废掉一整条 memo 链）写在那个文件开头
  const send = useSend(omni.send, {
    rows,
    lastUsed: prefs.settings.lastUsed,
    patch: prefs.patch,
    // 分叉 / 重来出来的那条是临时的（侧栏里没有它），**不跳过去就等于点了没反应**
    onBranch: () => {
      awaited.current = omni.lastStarted?.seq ?? 0
    },
  })

  const { open, openChat, openPicker } = useWorkspaceActions({
    state: omni.state,
    thread,
    send: omni.send,
    copy: omni.copy,
    pickFolder: omni.pickFolder,
    chatDir: omni.chatDir,
    onMenu: omni.onMenu,
    onSelect: shell.select,
    // 点「新建」的那一刻记下当前序号，等一个比它大的
    onCreating: () => {
      awaited.current = omni.lastStarted?.seq ?? 0
    },
    onOpenProject: (cwd) => {
      prefs.addProject(cwd)
    },
    // 兜底沿用当前会话；它被设置隐藏时才退到第一家，见纯函数里的表驱动测试。
    opened: openWithEngines(prefs.settings, thread?.engine, engines),
    defaultTrust: prefs.settings.defaultTrust,
    ...viewActions(shell),
  })

  return {
    state: omni.state,
    engines,
    rows,
    sidebarRows,
    thread,
    // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
    notices: omni.state.notices.filter((n) => !shell.dismissed.has(n.id)),
    shell,
    prefs,
    bridgeMissing: omni.bridgeMissing,
    ready: omni.ready,
    send,
    copy: omni.copy,
    reveal: omni.reveal,
    find: omni.find,
    stopFind: omni.stopFind,
    searchFiles: omni.searchFiles,
    open,
    openChat,
    openPicker,
    newHere: () => {
      if (thread === undefined) openPicker()
      else open(thread.cwd)
    },
    itemsOf: (threadId) => itemsOf(omni.state, threadId),
    items,
    foreign: foreignByEngine(omni.state),
    adopt: (engine, item) => {
      // 和新建走同一条「记下序号、等 thread.started」的路（见上面那段注释），
      // 接完自动跳过去——不跳的话人得自己去侧栏里找它，
      // 而它刚从「codex 历史」那一段里消失
      awaited.current = omni.lastStarted?.seq ?? 0
      omni.send({
        type: "thread.adopt",
        engine,
        handle: item.handle,
        cwd: item.cwd,
        title: item.title,
        ...(item.profile === undefined ? {} : { profile: item.profile }),
      })
    },
    // **跟着当前会话的引擎走**：底下那一行说的是「你现在用的是哪个号」，
    // 而你现在用的是哪一家由选中的会话决定。没选会话时退回唯一报过的那家
    account: accountLineOf(omni.state, thread?.engine),
  }
}

function useEnabledEngines(
  settings: SettingsApi["settings"],
  engines: ViewState["engines"],
): ViewState["engines"] {
  return useMemo(() => enabledEngines(settings, engines), [engines, settings])
}

/**
 * 当前会话的**主线**条目。
 *
 * `mainItems` 而不是 `itemsOf`：带 `lane` 的那些属于旁路，由 `LaneCard` 画，
 * 留在主线里就是同一件事出现两遍。**一条都不带 `lane` 时它原样返回**
 *（回放老记录就是这种情况），所以这一步在今天是零成本的。
 *
 * 稳定化必须在这儿，不能在组件里现场 `.filter()`——`Transcript` 的 memo 认引用，
 * 现场过滤的表现是「侧栏一开，主区打字就变卡」，而且没有任何地方报错。
 */
function useThreadItems(state: ViewState, thread: Thread | undefined): readonly Item[] {
  return useMemo(
    () => (thread === undefined ? EMPTY_ITEMS : mainItems(state, thread.id)),
    [state, thread],
  )
}

/**
 * 账号 + 额度 → 底部那一行。
 *
 * **剩余百分比拿「更紧的那个窗口」算**，和顶栏的警报同一个判据
 *（见 `limits.ts` 的 `urgent`）：周用了 40%、5 小时用了 95% 的时候，
 * 说「剩余 60%」是误导——五小时那个窗口才是马上要撞的墙。
 *
 * 额度报不上来就**不显示百分比**，不是显示 100%——那是撒谎。
 */
function accountLineOf(state: ViewState, engine: string | undefined): AccountLine | undefined {
  const which = pickEngine(state, engine)
  if (which === undefined) return undefined
  const account = accountOf(state, which)
  if (account === undefined) return undefined
  const used = tightest(limitsOf(state, which))
  return {
    label: account.label,
    ...(account.plan === undefined ? {} : { plan: account.plan }),
    ...(used === undefined ? {} : { remain: Math.max(0, 100 - Math.round(used)) }),
  }
}

/**
 * 底部那行显示哪一家的账号。
 *
 * 优先当前会话那家；它没报过账号（比如 Claude 的 SDK 就不给）时退回
 * **唯一**报过的那家。有两家都报过、而当前这家没报，就什么都不显示——
 * 那时候摆出另一家的号是误导：你看着 A 的会话，底下写着 B 的账号。
 */
function pickEngine(state: ViewState, engine: string | undefined): string | undefined {
  const known = Object.keys(state.accounts)
  if (engine !== undefined && known.includes(engine)) return engine
  return known.length === 1 ? known[0] : undefined
}

/** 两个窗口里用得更满的那个。都没有就 undefined。 */
function tightest(limits: RateLimits | undefined): number | undefined {
  const values = [limits?.primary?.usedPercent, limits?.secondary?.usedPercent].filter(
    (v): v is number => typeof v === "number",
  )
  return values.length === 0 ? undefined : Math.max(...values)
}
