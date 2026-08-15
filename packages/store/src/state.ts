import type { Item, ItemId, Thread, ThreadId, Turn, TurnId } from "@omni/protocol"

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
}

export function initial(): ViewState {
  return { threads: {}, order: [], items: {}, turns: {}, owner: {}, turnOwner: {} }
}

/** 取一个会话的 item 列表；不存在时给空数组，调用方不用判空。 */
export function itemsOf(state: ViewState, threadId: ThreadId): readonly Item[] {
  return state.items[threadId] ?? []
}

/** 取一个会话当前未结束的轮次；没有就是 undefined（空闲）。 */
export function turnOf(state: ViewState, threadId: ThreadId): Turn | undefined {
  return state.turns[threadId]
}

export function threadsOf(state: ViewState): readonly Thread[] {
  return state.order
    .map((id) => state.threads[id])
    .filter((t): t is Thread => t !== undefined)
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
