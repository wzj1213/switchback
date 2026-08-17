import { useEffect, useRef } from "react"
import { accountOf, foreignByEngine, itemsOf, limitsOf, threadRowsOf, type Notice, type ThreadRow, type ViewState } from "@omni/store"
import type { Item } from "@omni/protocol"
import type { Command, EngineThread, RateLimits, Thread } from "@omni/protocol"
import { useOmni } from "./useOmni.js"
import { useSettings, type SettingsApi } from "./useSettings.js"
import { useShell, type Shell } from "./useShell.js"
import type { AccountLine } from "./components/SidebarFoot.js"
import { useWorkspaceActions } from "./useWorkspaceActions.js"
import { learnFrom, openWith } from "./newThreadPrefs.js"

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
   */
  sidebarRows: readonly ThreadRow[]
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
  /** 开一条不属于任何项目的对话。 */
  openChat: () => void
  /** 侧栏「新建会话」：有当前会话就用它的目录，没有就先问路径。 */
  newHere: () => void
  itemsOf: (threadId: string) => readonly Item[]
  /** 报过历史的每一家，各一段。 */
  foreign: readonly { engine: string; threads: readonly EngineThread[] }[]
  /** 把某一家那边的一条会话接过来，接完跳过去。 */
  adopt: (engine: string, item: EngineThread) => void
  /** 底部那一行：登录的是谁、还剩多少额度。 */
  account: AccountLine | undefined
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
  // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
  const notices = omni.state.notices.filter((n) => !shell.dismissed.has(n.id))
  const thread = rows.find((r) => r.thread.id === shell.selectedId)?.thread ?? rows[0]?.thread

  /**
   * 命令的出口，顺路记下**下次新会话开成什么样**。
   *
   * 挂在发消息这一刻，是因为「挑好了引擎和模型，然后真的发出去」才是一次表态；
   * 光点开下拉看看不算——那可能只是在翻有哪些模型。剩下那半条规则
   *（同一条会话第二次发就不再记）在 `learnFrom` 里，两边共用同一份判断。
   *
   * 包在这里而不是输入框里：排队补发、`/` 面板、快捷键都从这条路出去，
   * 挂在输入框上会漏掉其余几条。
   */
  const send = (command: Command): void => {
    if (command.type === "thread.prompt") {
      const target = rows.find((r) => r.thread.id === command.threadId)?.thread
      const next = target === undefined ? undefined : learnFrom(prefs.settings.lastUsed, target)
      if (next !== undefined) prefs.patch({ lastUsed: next })
    }
    omni.send(command)
  }

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
    opened: openWith(
      prefs.settings.lastUsed,
      prefs.settings.defaultEngine,
      // 兜底：**沿用当前会话的引擎**——换个工作区不该顺带把内核也换了。
      // 一条会话都没有时退到探到的第一家
      thread?.engine ?? omni.state.engines[0]?.id ?? "claude",
    ),
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
    // 侧栏只看「已经算数」的那些。判据由宿主给（`provisional`），不在这里猜——
    // 猜的话（比如「没有 item 就算临时」）会把跨引擎分叉出来的空会话一起藏掉
    sidebarRows: rows.filter((r) => r.thread.provisional !== true),
    thread,
    notices,
    shell,
    prefs,
    bridgeMissing: omni.bridgeMissing,
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
      })
    },
    // **跟着当前会话的引擎走**：底下那一行说的是「你现在用的是哪个号」，
    // 而你现在用的是哪一家由选中的会话决定。没选会话时退回唯一报过的那家
    account: accountLineOf(omni.state, thread?.engine),
  }
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
