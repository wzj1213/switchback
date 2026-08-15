import type {
  EngineInfo,
  Item,
  ItemId,
  ModelOption,
  Thread,
  ThreadId,
  Turn,
  TurnId,
  Usage,
} from "@omni/protocol"

export interface ViewState {
  /** 会话表 */
  threads: Readonly<Record<ThreadId, Thread>>
  /** 侧栏顺序，最近创建在前 */
  order: readonly ThreadId[]
  /** 每个会话的 item 列表，按到达顺序 */
  items: Readonly<Record<ThreadId, readonly Item[]>>
  /** 每个会话当前未结束的轮次 */
  turns: Readonly<Record<ThreadId, Turn>>
  /** item id → 它属于哪个会话。`item.delta` / `item.updated` 只带 item id。 */
  owner: Readonly<Record<ItemId, ThreadId>>
  /** turn id → 它属于哪个会话。`turn.completed` 同理。 */
  turnOwner: Readonly<Record<TurnId, ThreadId>>
  /** 每个会话的上下文用量。引擎不报就没有这一项。 */
  usage: Readonly<Record<ThreadId, Usage>>
  /** 每个会话可选的模型。引擎报了才有。 */
  models: Readonly<Record<ThreadId, readonly ModelOption[]>>
  /** 这台机器上可用的引擎。宿主启动时报一次。 */
  engines: readonly EngineInfo[]
  /** 引擎层面的故障。最新在后。 */
  notices: readonly Notice[]
  /** 通知序号。归约器是纯函数，不能用时间戳或随机数当 id。 */
  noticeSeq: number
}

/**
 * 一条要让用户看见的引擎故障。
 *
 * 在这之前 `engine.status` 事件被归约器整个丢弃——引擎起不来、崩了、
 * 进程泄漏，界面上一律**毫无反应**。那不是「没做的功能」，那是故障被吞掉。
 */
export interface Notice {
  id: string
  at: number
  text: string
  /** 关联的会话；`thread.create` 阶段就失败时没有会话，这里是 undefined。 */
  threadId: ThreadId | undefined
}

export function initial(): ViewState {
  return {
    threads: {},
    order: [],
    items: {},
    turns: {},
    owner: {},
    turnOwner: {},
    usage: {},
    models: {},
    engines: [],
    notices: [],
    noticeSeq: 0,
  }
}

/** 取一个会话的 item 列表；不存在时给空数组，调用方不用判空。 */
export function itemsOf(state: ViewState, threadId: ThreadId): readonly Item[] {
  return state.items[threadId] ?? []
}

/** 取一个会话当前未结束的轮次；没有就是 undefined（空闲）。 */
export function turnOf(state: ViewState, threadId: ThreadId): Turn | undefined {
  return state.turns[threadId]
}

export function usageOf(state: ViewState, threadId: ThreadId): Usage | undefined {
  return state.usage[threadId]
}

export function modelsOf(state: ViewState, threadId: ThreadId): readonly ModelOption[] {
  return state.models[threadId] ?? []
}

export function threadsOf(state: ViewState): readonly Thread[] {
  return state.order
    .map((id) => state.threads[id])
    .filter((t): t is Thread => t !== undefined)
}

/**
 * 和这个会话有分叉血缘的**另一个**会话。
 *
 * 三种关系都算：我分叉出来的、把我分叉出来的、和我同源的兄弟。
 * 都不存在就返回 undefined，界面据此不显示「对比」按钮——
 * **一个点了没用的按钮比没有按钮糟**。
 *
 * 多个候选时取最近创建的那个。分叉三次以上是很少见的用法，
 * 为它摆一个选择器只会把顶栏挤满；真要比更早那次，从侧栏点过去再比。
 */
export function forkPeerOf(state: ViewState, threadId: ThreadId): Thread | undefined {
  const self = state.threads[threadId]
  if (self === undefined) return undefined
  const related = threadsOf(state).filter((t) => {
    if (t.id === threadId) return false
    if (t.forkedFrom === threadId) return true
    if (self.forkedFrom === undefined) return false
    return t.id === self.forkedFrom || t.forkedFrom === self.forkedFrom
  })
  return [...related].sort((a, b) => b.createdAt - a.createdAt)[0]
}

/**
 * 侧栏一行要的东西。
 *
 * `preview` 取**第一条用户消息**——同一个工作区可以开好几个会话，
 * 光靠目录名它们在侧栏里长得一模一样，分不出哪个是哪个。
 * codex 的 `Thread.preview` 就是这么定义的。
 */
export interface ThreadRow {
  thread: Thread
  preview: string | undefined
}

export function threadRowsOf(state: ViewState): readonly ThreadRow[] {
  return threadsOf(state).map((thread) => {
    const first = (state.items[thread.id] ?? []).find((i) => i.kind === "user_message")
    return { thread, preview: first?.kind === "user_message" ? first.text : undefined }
  })
}
