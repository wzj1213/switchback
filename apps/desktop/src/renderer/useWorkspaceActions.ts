import type { Command, Thread, Trust } from "@omni/protocol"
import { itemsOf, type ViewState } from "@omni/store"
import { labelOf } from "./components/Composer.js"
import { toMarkdown } from "./export.js"
import { useMenuActions } from "./useMenuActions.js"
import type { Opened } from "./newThreadPrefs.js"

/**
 * 「新建会话 / 换工作区 / 菜单动作」这一坨。
 *
 * 从 `App` 拆出来是行数闸门逼的，但它本来就该是一块：这些动作全都
 * **依赖同一份上下文**（当前会话 + 当前状态），散在组件里迟早会有一个忘了跟着更新，
 * 表现成「菜单里的新建和侧栏的新建行为不一样」。
 */
export interface WorkspaceActions {
  /** 在指定目录开一个新会话。 */
  open: (cwd: string, kind?: "project" | "chat") => void
  /** 开一条不属于任何项目的对话。 */
  openChat: () => void
  /** 弹系统目录框，选中了就开。 */
  openPicker: () => void
}

export function useWorkspaceActions(deps: {
  state: ViewState
  thread: Thread | undefined
  send: (command: Command) => void
  copy: (text: string) => void
  pickFolder: () => Promise<string | undefined>
  /** 给对话要一个自动生成的目录。 */
  chatDir: () => Promise<string>
  /** 把一个文件夹记进侧栏（不建会话）。 */
  onOpenProject: (cwd: string) => void
  onMenu: (handler: (action: string) => void) => () => void
  onSelect: (id: string | undefined) => void
  /** 刚发出「新建」。调用方据此等下一个 `thread.started`。 */
  onCreating: () => void
  onFind: () => void
  onCompare: () => void
  /** 打开审核面板。 */
  onReview: () => void
  onFilterThreads: () => void
  onSettings: () => void
  /**
   * 新会话开成什么样：引擎 + 模型 + 思维档。**已经按优先级算好了**
   *（见 `newThreadPrefs.ts` 的 `openWith`）——这里只负责发出去。
   */
  opened: Opened
  defaultTrust: Trust
}): WorkspaceActions {
  const { state, thread, send } = deps

  /**
   * 开新会话。
   *
   * 引擎/模型/思维档由 `deps.opened` 定（优先级见 `newThreadPrefs.ts`），
   * **模型在建的时候就给**，不是建完再设——中间那个窗口里发出去的第一句
   * 会跑在引擎默认模型上，而用户明明在新建之前就挑好了。
   */
  const open = (cwd: string, kind: "project" | "chat" = "project"): void => {
    send({
      type: "thread.create",
      cwd,
      ...(kind === "chat" ? { workspaceKind: "chat" as const, title: "新对话" } : {}),
      ...deps.opened,
      trust: deps.defaultTrust,
      title: cwd.split("/").filter(Boolean).pop() ?? cwd,
    })
    // 记下「我在等下一个新会话」。**不再用 `onSelect(undefined)` 兼职这个信号**——
    // 那个信号删会话时也会发，于是删完之后下一个冒出来的会话会被错认成我等的那个
    deps.onCreating()
    // 在哪儿开过会话，那儿就是个项目。**不记的话，把它的会话全删掉之后
    // 那个项目会整个从侧栏消失**——而用户只是清了几条对话，没打算移走项目
    if (kind !== "chat") deps.onOpenProject(cwd)
  }

  /**
   * 开一条**不挑项目**的对话。
   *
   * 目录由主进程自动生成——见 `main/chatdir.ts` 里为什么 `cwd` 不能为空。
   * 用户这边的体感是「点一下就能问」，不用先想「放哪个文件夹」。
   */
  const openChat = (): void => {
    void deps.chatDir().then((cwd) => {
      open(cwd, "chat")
    })
  }

  /**
   * 挑一个文件夹放进侧栏。**不建会话。**
   *
   * 上一版是顺手建一条的——因为侧栏的项目是从会话推出来的，不建就看不见。
   * 但那是本末倒置：**一个项目不必有会话**，你可能只是想先把它放进来，
   * 明天再开工；而每打开一个文件夹就多一条空会话，跑一周下来侧栏全是空壳。
   * 现在项目自己记一份（`Settings.projects`），要开会话点那一行的 `+`。
   */
  const openPicker = (): void => {
    void deps.pickFolder().then((cwd) => {
      if (cwd !== undefined) deps.onOpenProject(cwd)
    })
  }

  useMenuActions(
    deps.onMenu,
    {
      newThread: () => {
        if (thread === undefined) openPicker()
        else open(thread.cwd)
      },
      openFolder: openPicker,
      interrupt: () => {
        if (thread !== undefined) send({ type: "thread.interrupt", threadId: thread.id })
      },
      find: deps.onFind,
      compare: deps.onCompare,
      review: deps.onReview,
      settings: deps.onSettings,
      filterThreads: deps.onFilterThreads,
      copyMarkdown: () => {
        if (thread === undefined) return
        deps.copy(toMarkdown(thread, itemsOf(state, thread.id), labelOf(state.engines, thread.engine)))
      },
    },
    [thread?.id, thread?.cwd, state],
  )

  return { open, openChat, openPicker }
}
