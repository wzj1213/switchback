import type { Event, Item, ItemId, ThreadId } from "@omni/protocol"
import { type ViewState } from "./state.js"
import { reduceEngineNotification, reduceEngineStatus } from "./notices.js"
import { mergeRateLimits } from "./limits.js"

function withThread(state: ViewState, thread: ViewState["threads"][string]): ViewState {
  const known = state.threads[thread.id] !== undefined
  return {
    ...state,
    threads: { ...state.threads, [thread.id]: thread },
    order: known ? state.order : [thread.id, ...state.order],
  }
}

/**
 * `owner` 是 item → 会话的**全局**索引（跨所有会话），只在删会话时收缩。
 *
 * 每加一条 item 都 `{ ...state.owner }` 整表复制一次，于是回放的代价是
 * **O(总 item 数²)**。量出来的（这台机器）：1500 条 110ms、3000 条 602ms、
 * 9000 条 6.6 秒、20000 条 35 秒——冷启动和 ⌘R 会白屏，而且没有任何加载提示。
 * 判据确实是 owner 而不是 items 数组：1×5000 与 10×500 耗时一样，
 * 而把这一行换成不复制，9000 条从 6620ms 降到 36ms。
 *
 * 改完（同一台机器）：1500 条 3ms、3000 条 4ms、9000 条 27ms——从平方级回到近似线性。
 *
 * 所以 `reduceAll` 走批量路径时给一个**可变累加器**：整批只在开头复制一次，
 * 中间就地写。这是标准的 transient 手法，安全性来自两条——
 * 累加器是 `reduceAll` 内部造的（传入的 state 不会被改），
 * 中间态不会流到外面（一路 reduce 完才返回）。
 * 单条 `reduce` 不传累加器，语义和以前一模一样。
 */
function appendItem(state: ViewState, threadId: ThreadId, item: Item, draft?: Draft): ViewState {
  const owner = draft?.owner ?? { ...state.owner }
  owner[item.id] = threadId
  const list = state.items[threadId] ?? []
  // **同一条 item 来两次就替换，不追加。**
  //
  // 全量重建拼的是两份来源：磁盘上的历史，加上「读磁盘期间又发生的那些」
  //（见 `apps/desktop/src/main/host.ts` 的 `rebuild`）。两份**必然有重叠**——
  // 一条事件既可能已经落进 journal，又还在保留缓冲里，而没有任何办法在
  // 拼装时判断它进没进磁盘那一份。
  //
  // 于是这里把「应用两次」变成无害的：`item.started` 重复不再长出两条一样的
  // item。反过来（拼装时去重）要求给每条事件一个身份，那是把复杂度推给
  // **每一个**产生事件的地方，而这里只需要一次比较。
  const at = list.findIndex((existing) => existing.id === item.id)
  if (at !== -1) {
    const updated = [...list]
    updated[at] = item
    return { ...state, items: { ...state.items, [threadId]: updated }, owner }
  }
  return {
    ...state,
    items: { ...state.items, [threadId]: [...list, item] },
    owner,
  }
}

/** 批量归约时的可变累加器。**只在 `reduceAll` 内部存在。** */
interface Draft {
  owner: Record<ItemId, ThreadId>
}

/** 摘掉一条 item 及其反查项。未知 id 幂等忽略，迟到更新因此也无法复活它。 */
function removeItem(state: ViewState, itemId: ItemId, draft?: Draft): ViewState {
  const threadId = state.owner[itemId]
  if (threadId === undefined) return state
  const owner = omit(state.owner, itemId)
  if (draft !== undefined) draft.owner = owner
  return {
    ...state,
    items: { ...state.items, [threadId]: (state.items[threadId] ?? []).filter((item) => item.id !== itemId) },
    owner,
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
    // 新一轮出生就清上一轮可能迟到留下的进度；后续事件还要凭 turnId 才能写回来
    thinking: omit(state.thinking, turn.threadId),
  }
}

/** 不可变地摘掉一个键。用 rest 而不是 `delete`——后者会改写传入对象。 */
function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

function withEngine<T>(
  record: Readonly<Record<string, Readonly<Record<string, T>>>>,
  threadId: ThreadId,
  engine: string,
  value: T,
): Record<string, Readonly<Record<string, T>>> {
  return { ...record, [threadId]: { ...record[threadId], [engine]: value } }
}

function withoutEngine<T>(
  record: Readonly<Record<string, Readonly<Record<string, T>>>>,
  threadId: ThreadId,
  engine: string,
): Record<string, Readonly<Record<string, T>>> {
  const current = record[threadId]
  if (current === undefined) return { ...record }
  const next = omit(current, engine)
  return Object.keys(next).length === 0 ? omit(record, threadId) : { ...record, [threadId]: next }
}

/** 旧 journal 的用量事件没有 engine；按它前面的 thread 快照迁移到当时引擎。 */
function usageEngine(
  state: ViewState,
  event: Extract<Event, { type: "usage.updated" }>,
): string | undefined {
  const legacy = event as typeof event & { engine?: string }
  return legacy.engine ?? state.threads[event.threadId]?.engine
}

function onTurnCompleted(
  state: ViewState,
  event: Extract<Event, { type: "turn.completed" }>,
): ViewState {
  const threadId = state.turnOwner[event.turnId]
  if (threadId === undefined) return state
  // **子 agent 跟着轮次一起清。** 它们是活状态：一轮结束还留着，界面上就是一串
  // 早就跑完了、却还显示在跑的任务——比不显示更糟
  return {
    ...state,
    turns: omit(state.turns, threadId),
    tasks: omit(state.tasks, threadId),
    thinking: omit(state.thinking, threadId),
  }
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
    tasks: omit(state.tasks, threadId),
    thinking: omit(state.thinking, threadId),
    // 漏了这张就是内存泄漏：lane 里可能挂着一整棵 30 节点的树
    lanes: omit(state.lanes, threadId),
    models: omit(state.models, threadId),
    commands: omit(state.commands, threadId),
    owner: keepOwner,
    turnOwner: keepTurnOwner,
  }
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
  event: Extract<Event, { type: "usage.updated" | "usage.cleared" | "models.updated" | "engines.available" }>,
): ViewState {
  if (event.type === "engines.available") return { ...state, engines: event.engines }
  if (event.type === "models.updated") {
    return { ...state, models: withEngine(state.models, event.threadId, event.engine, event.models) }
  }
  if (event.type === "usage.cleared") {
    return { ...state, usage: withoutEngine(state.usage, event.threadId, event.engine) }
  }
  const engine = usageEngine(state, event)
  if (engine === undefined) return state
  return {
    ...state,
    usage: withEngine(state.usage, event.threadId, engine, event.usage),
  }
}

/** item 四种事件单独拎出来，纯粹为了让 `reduce` 的分支数不撞闸门。 */
function reduceItem(
  state: ViewState,
  event: Extract<Event, { type: "item.started" | "item.delta" | "item.updated" | "item.removed" }>,
  draft?: Draft,
): ViewState {
  if (event.type === "item.removed") return removeItem(state, event.itemId, draft)
  if (event.type === "item.delta") {
    return patchItem(state, event.itemId, (prev) => applyDelta(prev, event.append))
  }
  if (event.type === "item.updated") return patchItem(state, event.item.id, () => event.item)
  const threadId = state.turnOwner[event.item.turnId]
  return threadId === undefined ? state : appendItem(state, threadId, event.item, draft)
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
  [K in Event["type"]]: (state: ViewState, event: Extract<Event, { type: K }>, draft?: Draft) => ViewState
}

const HANDLERS: Handlers = {
  "thread.started": (state, event) => withThread(state, event.thread),
  "thread.updated": (state, event) => withThread(state, event.thread),
  "thread.removed": (state, event) => removeThread(state, event.threadId),
  "thread.renamed": (state, event) => {
    const thread = state.threads[event.threadId]
    // 不认识的 id 直接忽略：改名事件可能先于会话本身到达（补发乱序），
    // 而**凭空造一个只有标题的会话**比丢掉这次改名糟得多
    return thread === undefined ? state : withThread(state, { ...thread, title: event.title, named: true })
  },
  "turn.started": onTurnStarted,
  "turn.completed": onTurnCompleted,
  "item.started": reduceItem,
  "item.delta": reduceItem,
  "item.updated": reduceItem,
  "item.removed": reduceItem,
  "usage.updated": reduceCatalog,
  "usage.cleared": reduceCatalog,
  // **整份替换**：全量的好处是没有「漏发一次删除」这个失败模式（见事件定义）
  "tasks.updated": (state, event) => ({
    ...state,
    tasks: { ...state.tasks, [event.threadId]: event.tasks },
  }),
  "thinking.updated": (state, event) => {
    if (state.turns[event.threadId]?.id !== event.turnId) return state
    if (event.estimatedTokens === undefined) {
      return { ...state, thinking: omit(state.thinking, event.threadId) }
    }
    return {
      ...state,
      thinking: {
        ...state.thinking,
        [event.threadId]: { turnId: event.turnId, estimatedTokens: event.estimatedTokens },
      },
    }
  },
  "commands.updated": (state, event) => ({
    ...state,
    commands: withEngine(state.commands, event.threadId, event.engine, event.commands),
  }),
  "models.updated": reduceCatalog,
  "engines.available": reduceCatalog,
  "limits.updated": (state, event) => ({
    ...state,
    limits: {
      ...state.limits,
      [event.engine]: mergeRateLimits(state.limits[event.engine], event.limits),
    },
  }),
  /**
   * **upsert，同 id 整条替换。** 没有「起」和「改」两条事件，所以这里也只有一个分支。
   *
   * 追加在末尾而不是排序：lane 的顺序就是它被报出来的顺序，而界面上那排标签
   * 按这个顺序排正好是「先开的在左边」。重新排会让标签在跑的过程中跳位置。
   */
  "lane.updated": (state, event) => {
    const before = state.lanes[event.threadId] ?? []
    const at = before.findIndex((l) => l.id === event.lane.id)
    // **出生时刻不跟着更新走**：界面按 `at` 把卡片插进转录区，
    // 跟着走的话一条跑十分钟的 workflow 会在对话里一路往下爬
    const born = before[at]?.at
    const next = born === undefined ? event.lane : { ...event.lane, at: born }
    const after = at < 0 ? [...before, next] : before.map((l) => (l.id === next.id ? next : l))
    return { ...state, lanes: { ...state.lanes, [event.threadId]: after } }
  },
  "engine.status": reduceEngineStatus,
  "engine.notification": reduceEngineNotification,
  // 两者都是「整份替换」：引擎报一次就是当前全貌，不是增量
  "engine.history": (state, event) => ({
    ...state,
    engineThreads: { ...state.engineThreads, [event.engine]: event.threads },
  }),
  "account.updated": (state, event) => ({
    ...state,
    accounts: { ...state.accounts, [event.engine]: event.account },
  }),
}

/**
 * 事件 → 状态。纯函数、不可变。
 *
 * 运行期收到表里没有的事件（比如新版本宿主发来的）**原样返回旧状态**：
 * 渲染层永远不该因为一个没见过的事件崩掉。
 */
export function reduce(state: ViewState, event: Event, draft?: Draft): ViewState {
  const handler = HANDLERS[event.type] as
    | ((state: ViewState, event: Event, draft?: Draft) => ViewState)
    | undefined
  return handler === undefined ? state : handler(state, event, draft)
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

/**
 * 把一条会话**补来的历史**灌进去。
 *
 * ## 为什么不能直接 `reduceAll`
 *
 * 补历史的场景是「这条会话的正文没进全量，现在单独补一份」。
 * 而这期间它完全可能已经在直播——你人在列表页，它照样在跑，
 * `item.started` 一条条从事件流上过来了。这时候再 `reduceAll` 一份历史：
 * 已经有的那几条被就地替换（`appendItem` 按 id 幂等），
 * **而更早的那些被追加在它们后面**——转录区于是变成「最新的排在最前」，
 * 中间还夹着旧的。看起来不像坏了，只是读起来完全不对。
 *
 * 所以这里的做法是**先把这条会话的条目清空，再按历史的顺序重建**。
 * 历史是宿主 flush 过磁盘之后读的，本来就是那一刻的全量；
 * 读完之后新产生的那些会照常从事件流上过来，追加在后面——顺序自然是对的。
 *
 * **只清这一条的条目**：别的会话、以及这条会话的轮次/额度那些不动，
 * 它们的当前值比历史里那一份新。
 */
export function reduceHistory(state: ViewState, threadId: ThreadId, events: readonly Event[]): ViewState {
  const cleared: ViewState = { ...state, items: { ...state.items, [threadId]: [] } }
  return reduceAll(cleared, events)
}

export function reduceAll(state: ViewState, events: readonly Event[]): ViewState {
  const list = coalesce(events)
  // 一条的时候不值得开累加器：多一次整表复制，反而更慢
  if (list.length <= 1) return list.reduce((acc, event) => reduce(acc, event), state)
  const draft: Draft = { owner: { ...state.owner } }
  return list.reduce((acc, event) => reduce(acc, event, draft), state)
}
