import type { Command, Thread, Trust } from "@omni/protocol"
import { itemsOf, type ViewState } from "@omni/store"
import { labelOf } from "./components/Composer.js"
import { toMarkdown } from "./export.js"
import { useMenuActions } from "./useMenuActions.js"

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
  onMenu: (handler: (action: string) => void) => () => void
  onSelect: (id: string | undefined) => void
  /** 刚发出「新建」。调用方据此等下一个 `thread.started`。 */
  onCreating: () => void
  onFind: () => void
  onCompare: () => void
  onFilterThreads: () => void
  onSettings: () => void
  /** 偏好里设的默认引擎；空串表示「沿用当前会话的」。 */
  defaultEngine: string
  defaultTrust: Trust
}): WorkspaceActions {
  const { state, thread, send } = deps

  /**
   * 开新会话。
   *
   * 优先级：**偏好里设的默认 > 当前会话的 > 兜底**。
   * 沿用当前会话是为了「换工作区不该顺带把内核也换了」；
   * 但用户如果在设置里明确指定了默认，那句话就该压过前者——
   * 他设它就是为了不再每次手改。
   */
  const open = (cwd: string, kind: "project" | "chat" = "project"): void => {
    send({
      type: "thread.create",
      cwd,
      ...(kind === "chat" ? { workspaceKind: "chat" as const, title: "新对话" } : {}),
      engine: deps.defaultEngine !== "" ? deps.defaultEngine : (thread?.engine ?? state.engines[0]?.id ?? "claude"),
      trust: deps.defaultTrust,
      title: cwd.split("/").filter(Boolean).pop() ?? cwd,
    })
    // 记下「我在等下一个新会话」。**不再用 `onSelect(undefined)` 兼职这个信号**——
    // 那个信号删会话时也会发，于是删完之后下一个冒出来的会话会被错认成我等的那个
    deps.onCreating()
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

  const openPicker = (): void => {
    void deps.pickFolder().then((cwd) => {
      if (cwd !== undefined) open(cwd)
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
