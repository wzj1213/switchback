import type { EngineAccount, EngineInfo, EngineThread, Item, ItemId, ModelOption, RateLimits, SlashCommand, Thread, ThreadId, Turn, TurnId, Usage } from "@omni/protocol"

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
  /**
   * 每个会话可选的模型，**连同报它的那家引擎**。引擎报了才有。
   *
   * 记着「谁报的」是为了切引擎之后不撒谎：见 `modelsOf`。
   */
  models: Readonly<Record<ThreadId, { engine: string; list: readonly ModelOption[] }>>
  /** 这台机器上可用的引擎。宿主启动时报一次。 */
  engines: readonly EngineInfo[]
  /** 引擎层面的故障。最新在后。 */
  notices: readonly Notice[]
  /**
   * 引擎自己存着的会话（你在终端、别的界面里跑过的）。按引擎分。
   *
   * **和 `threads` 分开存**：那些是 omni 建的、有完整记录的；这些只有一行标题，
   * 内容还在引擎那边。混进同一张表的话，界面就分不出「这条我有记录」和
   * 「这条只是听说过」，而这两者能做的事完全不同。
   */
  engineThreads: Readonly<Record<string, readonly EngineThread[]>>
  /** 各家引擎登录的账号。额度算在谁头上，看这个。 */
  accounts: Readonly<Record<string, EngineAccount>>
  /** 通知序号。归约器是纯函数，不能用时间戳或随机数当 id。 */
  noticeSeq: number
  /** 每个会话能用的斜杠命令。引擎报什么就是什么，omni 自己那几条在渲染层拼。 */
  commands: Readonly<Record<string, readonly SlashCommand[]>>
  /** 各家引擎的账号额度。**按引擎存不按会话存**——额度是账号级的。 */
  limits: Readonly<Record<string, RateLimits>>
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
  /**
   * 这是哪一类问题。**横幅的抬头照它写。**
   *
   * 上一版抬头写死「引擎故障」。而 `degraded` 说的是引擎好好的、只是掉了能力
   *（MCP 没起来、没登录），把它顶着「引擎故障」四个字端出去，
   * 等于把排查引到错的方向——**这正是当初不用 `crashed` 的理由**，
   * 结果在界面上又还回去了。
   */
  kind: "crashed" | "degraded"
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
    commands: {},
    limits: {},
    engines: [],
    notices: [],
    engineThreads: {},
    accounts: {},
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

/**
 * 一个会话现在能选哪些模型。**要求这份清单正是当前这家引擎报的**，
 * 对不上就当没有。
 *
 * ## 为什么不是简单地取出来就完了
 *
 * 模型 id 是各家私有的，而一条会话中途会换引擎。切过去之后新那家的清单
 * 是**异步**才到的，而且它完全可能一个都报不上来（`models()` 失败就是空数组，
 * 那时宿主什么都不发）。只按会话 id 取的话，那段时间里界面上摆的是
 * **上一家的模型**——点一下就拿 claude 的模型 id 去设给 codex。
 *
 * 判据放在这里而不是让每个调用方自己比：漏比一处就是一个会撒谎的控件，
 * 而它不会报错。
 */
export function modelsOf(state: ViewState, threadId: ThreadId, engine: string): readonly ModelOption[] {
  const known = state.models[threadId]
  return known?.engine === engine ? known.list : []
}

/** 取一个会话能用的斜杠命令。引擎没报过就是空的，界面据此只显示 omni 自己那几条。 */
/** 取一家引擎的额度。没报过就是 undefined，界面据此什么都不画。 */
export function limitsOf(state: ViewState, engine: string): RateLimits | undefined {
  return state.limits[engine]
}

export function commandsOf(state: ViewState, threadId: ThreadId): readonly SlashCommand[] {
  return state.commands[threadId] ?? []
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

/** 目录名当项目名。整条绝对路径在一行里放不下，而尾段正是人叫它的那个名字。 */
export function baseNameOf(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "/"
}

/** 一个项目：一个工作区目录，底下挂着它的会话。 */
export interface Project {
  cwd: string
  /** 目录名。同名的不同目录靠 `cwd` 区分，界面上要不要展开写路径自己决定。 */
  name: string
  rows: readonly ThreadRow[]
}

/**
 * 按工作区把会话归堆。
 *
 * ## 为什么放在这里而不是各端各写一份
 *
 * 桌面侧栏早就这么分了（`renderer/sidebar.ts`），而浏览器端是一条平列表——
 * 于是**同一台机器上的同一批会话，在两端长得完全不一样**：一边分着项目，
 * 一边十几条混在一起，谁属于哪个仓库全靠标题猜。
 *
 * 这里只做「怎么归堆」这一件事，不管置顶、折叠、手动排序——那些是桌面侧栏
 * 自己的东西，摊到手机上没有意义。**组内顺序沿用传进来的顺序**（调用方已经排过），
 * 组间按各自最新那条的时间排：你回头找的是「刚才在弄的那个项目」。
 */
export function projectsOf(rows: readonly ThreadRow[]): readonly Project[] {
  const groups = new Map<string, ThreadRow[]>()
  for (const row of rows) {
    const found = groups.get(row.thread.cwd)
    if (found === undefined) groups.set(row.thread.cwd, [row])
    else found.push(row)
  }
  const newest = (list: readonly ThreadRow[]): number =>
    list.reduce((max, r) => Math.max(max, r.thread.updatedAt), 0)
  return [...groups.entries()]
    .map(([cwd, list]) => ({ cwd, name: baseNameOf(cwd), rows: list }))
    .sort((a, b) => newest(b.rows) - newest(a.rows))
}

/**
 * 把横幅清空。**全量重建之后必须调一次。**
 *
 * 横幅说的是「刚刚发生了一件事」——一个时刻，不是一个状态。
 * 而 `engine.status` 是落盘的（它要拿来还原会话状态），
 * 于是全量重放会把**历史上每一次引擎崩溃**重新弹一遍：
 * 重启 omni，迎面几条上周的红条，而那时候的事早就过去了。
 *
 * 和 `thread.removed` 不落盘是同一条道理：
 * **全量重建出来的是「世界现在长什么样」**，不是「都发生过什么」。
 */
export function clearNotices(state: ViewState): ViewState {
  return state.notices.length === 0 ? state : { ...state, notices: [] }
}

/**
 * 引擎自己存着的那些会话。**omni 没有它们的记录**，只有一行标题。
 * 界面据此单独成段——和 omni 建的会话混在一起会让人以为点开就能看见内容。
 */
export function engineThreadsOf(state: ViewState, engine: string): readonly EngineThread[] {
  return state.engineThreads[engine] ?? []
}

/**
 * 装了的每一家，各一段历史。
 *
 * ## 为什么按「装了的引擎」而不是「报过历史的引擎」
 *
 * 历史是**握手时问出来的**，也就是说你没在 omni 里开过 Claude 会话，
 * Claude 那一段就整个不存在。而「这里能放什么」恰恰是还没用过的人最需要知道的
 * ——这条在侧栏别的段上已经吃过一次亏（置顶段空了就整段消失，
 * 于是「怎么置顶」只有会用的人看得见）。空着也给段头，空态里说清楚为什么空。
 *
 * ## 为什么一家一段而不是合并
 *
 * 找的时候人想的是「我昨天在 Claude 里跑的那个」，引擎本身就是最强的筛选条件。
 * 合成一段之后每行都得挂个引擎角标，而那正是分段能免掉的东西。
 *
 * 顺序跟着引擎清单走，**不按条数或时间排**——侧栏里一段的位置每次启动都变的话，
 * 肌肉记忆就废了。
 */
export function foreignByEngine(state: ViewState): readonly { engine: string; threads: readonly EngineThread[] }[] {
  const listed = state.engines.filter((e) => e.state !== "missing").map((e) => e.id)
  // 报过历史但不在清单里的也带上：清单迟到时不该让已有的一段闪一下才出现
  const extra = Object.keys(state.engineThreads).filter((id) => !listed.includes(id))
  return [...listed, ...extra].map((engine) => ({ engine, threads: state.engineThreads[engine] ?? [] }))
}

/** 某家引擎登录的账号。没报过就是 undefined，界面据此什么都不画。 */
export function accountOf(state: ViewState, engine: string): EngineAccount | undefined {
  return state.accounts[engine]
}
