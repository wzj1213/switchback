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
/** 「整份替换某张表」的几支。和 item 三兄弟一样，拎出来是为了分支数不撞闸门。 */
function reduceCatalog(
  state: ViewState,
  event: Extract<Event, { type: "usage.updated" | "models.updated" | "engines.available" }>,
): ViewState {
  if (event.type === "engines.available") return { ...state, engines: event.engines }
  if (event.type === "models.updated") {
    return { ...state, models: { ...state.models, [event.threadId]: event.models } }
  }
  return { ...state, usage: { ...state.usage, [event.threadId]: event.usage } }
}

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

/**
 * 事件 → 处理函数。
 *
 * 用**由联合类型映射出来的表**而不是 switch，有两个理由：
 *
 * 1. 漏处理一种事件会**编译不过**。原先那个 switch 的 `default: return state`
 *    恰恰把这件事藏了起来——新增一种事件、忘了接，界面静默无反应，
 *    而排查的人先怀疑的永远不是归约器。
 * 2. 分支数就是协议的大小，不是可以拆掉的复杂度；表的形式让它不再是一坨 switch。
 */
type Handlers = {
  [K in Event["type"]]: (state: ViewState, event: Extract<Event, { type: K }>) => ViewState
}

const HANDLERS: Handlers = {
  "thread.started": (state, event) => withThread(state, event.thread),
  "thread.updated": (state, event) => withThread(state, event.thread),
  "thread.removed": (state, event) => removeThread(state, event.threadId),
  "turn.started": onTurnStarted,
  "turn.completed": onTurnCompleted,
  "item.started": reduceItem,
  "item.delta": reduceItem,
  "item.updated": reduceItem,
  "usage.updated": reduceCatalog,
  "models.updated": reduceCatalog,
  "engines.available": reduceCatalog,
  "engine.status": onEngineStatus,
}

/**
 * 事件 → 状态。纯函数、不可变。
 *
 * 运行期收到表里没有的事件（比如新版本宿主发来的）**原样返回旧状态**：
 * 渲染层永远不该因为一个没见过的事件崩掉。
 */
export function reduce(state: ViewState, event: Event): ViewState {
  const handler = HANDLERS[event.type] as ((state: ViewState, event: Event) => ViewState) | undefined
  return handler === undefined ? state : handler(state, event)
}

/**
 * 把**挨着的、同一条 item 的** delta 并成一条。
 *
 * ## 为什么值得单独做这一步
 *
 * `reduce` 是纯函数，每处理一条事件就复制一遍那条会话的 item 列表。
 * 而流式文本是一个字符一条 delta——`pnpm build` 那种刷屏命令一批能来 500 条，
 * 于是**同一个数组被复制 500 次**，只为了把 500 个片段接到同一个字符串尾巴上。
 *
 * 合帧（`apps/desktop/src/main/batch.ts`）解决的是「发几次 IPC」，
 * 这里解决的是「发到之后归约几次」。两件事，两个地方。
 *
 * ## 量出来的（2026-08-15，500 条 delta，也就是一批的上限）
 *
 * | 历史 item | 逐条归约 | 先合并 | 倍数 |
 * | --- | --- | --- | --- |
 * | 50 | 0.20 ms | 0.03 ms | 7× |
 * | 500 | 1.17 ms | 0.03 ms | 36× |
 * | 2000 | 4.77 ms | 0.04 ms | 128× |
 *
 * 逐条是 **O(历史条数 × delta 条数)**——**会话越长越慢**，
 * 这正好对上「用着用着就卡了」。一帧 16 ms，2000 条历史时光归约就吃掉 4.8 ms，
 * React 还没开始干活。合并之后这一项基本归零，而且不再随历史增长。
 *
 * 复现：把这段 delta 数组喂给 `deltas.reduce(reduce, start)` 和
 * `coalesce(deltas).reduce(reduce, start)` 各跑 20 遍取平均。
 * 没把它留成测试，是因为掐表的断言换台机器就随机红，红了也说明不了问题。
 *
 * ## 为什么只合「挨着的」
 *
 * 中间夹了别的事件就断开——比如 `item.completed`、另一条 item 的 delta。
 * 跨过它们去合并会改变事件的先后关系，而**顺序是这套东西唯一的正确性来源**。
 * 只合挨着的同 id delta，语义上和逐条应用完全等价：字符串拼接满足结合律。
 */
export function coalesce(events: readonly Event[]): readonly Event[] {
  const out: Event[] = []
  for (const event of events) {
    const last = out[out.length - 1]
    if (
      event.type === "item.delta" &&
      last?.type === "item.delta" &&
      last.itemId === event.itemId
    ) {
      out[out.length - 1] = { ...last, at: event.at, append: last.append + event.append }
      continue
    }
    out.push(event)
  }
  return out
}

export function reduceAll(state: ViewState, events: readonly Event[]): ViewState {
  return coalesce(events).reduce(reduce, state)
}
