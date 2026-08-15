import type { Event, Item, ItemId, ThreadId } from "@omni/protocol"
import { type Notice, type ViewState } from "./state.js"

function withThread(state: ViewState, thread: ViewState["threads"][string]): ViewState {
  const known = state.threads[thread.id] !== undefined
  return {
    ...state,
    threads: { ...state.threads, [thread.id]: thread },
    order: known ? state.order : [thread.id, ...state.order],
  }
}

function appendItem(state: ViewState, threadId: ThreadId, item: Item): ViewState {
  return {
    ...state,
    items: { ...state.items, [threadId]: [...(state.items[threadId] ?? []), item] },
    owner: { ...state.owner, [item.id]: threadId },
  }
}

/** 就地替换一条 item。找不到宿主会话时原样返回——认不出的事件不该让状态崩。 */
function patchItem(state: ViewState, itemId: ItemId, next: (prev: Item) => Item): ViewState {
  const threadId = state.owner[itemId]
  if (threadId === undefined) return state
  const list = state.items[threadId] ?? []
  const index = list.findIndex((i) => i.id === itemId)
  if (index === -1) return state
  const prev = list[index]
  if (prev === undefined) return state
  const updated = [...list]
  updated[index] = next(prev)
  return { ...state, items: { ...state.items, [threadId]: updated } }
}

/**
 * 实时输出的上限，**留尾不留头**。
 *
 * 一条 `pnpm build` 能吐几 MB；不封顶的话它一直堆在内存里，而且渲染一个
 * 几 MB 的 `<pre>` 会把界面拖垮。命令跑着的时候人要看的是它**现在**在干什么，
 * 不是三分钟前的第一行。
 *
 * 收工时 `item.updated` 会用引擎给的完整输出整条替换，所以这里的截断只影响
 * 运行期间的实时视图。
 */
const MAX_LIVE_OUTPUT = 8000

/** 流式文本吃增量；shell 调用的输出也吃——那是「命令跑着时看得到滚动」的来源。 */
function applyDelta(prev: Item, append: string): Item {
  if (prev.kind === "agent_message" || prev.kind === "reasoning") {
    return { ...prev, text: prev.text + append }
  }
  if (prev.kind === "tool_call" && prev.detail.kind === "shell") {
    const grown = (prev.detail.output ?? "") + append
    const output = grown.length <= MAX_LIVE_OUTPUT ? grown : grown.slice(-MAX_LIVE_OUTPUT)
    return { ...prev, detail: { ...prev.detail, output } }
  }
  return prev
}

function onTurnStarted(state: ViewState, event: Extract<Event, { type: "turn.started" }>): ViewState {
  const { turn } = event
  return {
    ...state,
    turns: { ...state.turns, [turn.threadId]: turn },
    turnOwner: { ...state.turnOwner, [turn.id]: turn.threadId },
  }
}

/** 不可变地摘掉一个键。用 rest 而不是 `delete`——后者会改写传入对象。 */
function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

function onTurnCompleted(
  state: ViewState,
  event: Extract<Event, { type: "turn.completed" }>,
): ViewState {
  const threadId = state.turnOwner[event.turnId]
  if (threadId === undefined) return state
  return { ...state, turns: omit(state.turns, threadId) }
}

/**
 * 摘掉一个会话的全部痕迹。
 *
 * `owner` / `turnOwner` 里的反查项也要清——留着的话，一条迟到的
 * `item.updated` 会把内容写回一个已经不存在的会话，那份数据从此再也删不掉。
 */
function removeThread(state: ViewState, threadId: ThreadId): ViewState {
  const keepOwner = Object.fromEntries(
    Object.entries(state.owner).filter(([, id]) => id !== threadId),
  )
  const keepTurnOwner = Object.fromEntries(
    Object.entries(state.turnOwner).filter(([, id]) => id !== threadId),
  )
  return {
    ...state,
    threads: omit(state.threads, threadId),
    order: state.order.filter((id) => id !== threadId),
    items: omit(state.items, threadId),
    turns: omit(state.turns, threadId),
    usage: omit(state.usage, threadId),
    models: omit(state.models, threadId),
    owner: keepOwner,
    turnOwner: keepTurnOwner,
  }
}

/** 只有这两档需要打断用户。`starting` / `ready` / `exited` 是正常生命周期。 */
const LOUD = new Set(["crashed", "timeout"])

/** 最多留这么多条，够排查即可——它不是日志。 */
const MAX_NOTICES = 20

function onEngineStatus(
  state: ViewState,
  event: Extract<Event, { type: "engine.status" }>,
): ViewState {
  if (!LOUD.has(event.status)) return state
  const seq = state.noticeSeq + 1
  const notice: Notice = {
    id: `n${String(seq)}`,
    at: event.at,
    text: event.detail ?? "引擎报告了一个没有描述的故障",
    threadId: event.threadId === "" ? undefined : event.threadId,
  }
  return { ...state, noticeSeq: seq, notices: [...state.notices, notice].slice(-MAX_NOTICES) }
}

/**
 * 事件 → 状态。纯函数、不可变。
 *
 * **认不出的事件原样返回旧状态**，不抛也不记录。代价是新增事件类型时界面静默无反应，
 * 收益是渲染层永远不会因为一个没见过的事件崩掉。排查「点了没反应」先查这里。
 */
/** item 三兄弟单独拎出来，纯粹为了让 `reduce` 的分支数不撞闸门。 */
function reduceItem(
  state: ViewState,
  event: Extract<Event, { type: "item.started" | "item.delta" | "item.updated" }>,
): ViewState {
  if (event.type === "item.delta") {
    return patchItem(state, event.itemId, (prev) => applyDelta(prev, event.append))
  }
  if (event.type === "item.updated") return patchItem(state, event.item.id, () => event.item)
  const threadId = state.turnOwner[event.item.turnId]
  return threadId === undefined ? state : appendItem(state, threadId, event.item)
}

export function reduce(state: ViewState, event: Event): ViewState {
  switch (event.type) {
    case "thread.started":
    case "thread.updated":
      return withThread(state, event.thread)
    case "thread.removed":
      return removeThread(state, event.threadId)
    case "turn.started":
      return onTurnStarted(state, event)
    case "turn.completed":
      return onTurnCompleted(state, event)
    case "item.started":
    case "item.delta":
    case "item.updated":
      return reduceItem(state, event)
    case "usage.updated":
      return { ...state, usage: { ...state.usage, [event.threadId]: event.usage } }
    case "models.updated":
      return { ...state, models: { ...state.models, [event.threadId]: event.models } }
    case "engine.status":
      return onEngineStatus(state, event)
    default:
      return state
  }
}

export function reduceAll(state: ViewState, events: readonly Event[]): ViewState {
  return events.reduce(reduce, state)
}
