import type { Aside, EngineSegment, Item, ToolCallItem } from "@omni/protocol"
import { reportedChangesOf, type Changes } from "./changes.js"
import { engineSwitches, type EngineStint } from "./engine-mark.js"

/**
 * 连续的工具调用合成一组。
 *
 * 一次请求里 agent 常常连着调四五个工具；一个调用一个卡片会把 transcript 变成
 * 一摞方块。合成一组之后它们共用一条左轨，读起来像「一段活动」而不是「五个事件」。
 */
export type Row =
  | { kind: "item"; item: Exclude<Item, ToolCallItem> }
  | { kind: "run"; items: readonly ToolCallItem[] }
  /** 一轮的分界：跑完之后插在那一轮的提问和回答之间，说这一轮花了多久。 */
  | { kind: "turn"; turnId: string; ms: number }
  /**
   * 一次侧问。**它不属于任何一轮**，也不在 `items` 里——挂在 `Thread.asides` 上，
   * 由 `withAsides` 按时间插进来（见那个函数的注释）。
   */
  | { kind: "aside"; aside: Aside }
  /**
   * 一轮改了哪些文件，跟在那一轮的末尾。**每轮一张，不是整条会话一张**——
   * 为什么，见 `components/TurnEdits.tsx` 开头。
   */
  | { kind: "edits"; turnId: string; edits: Changes }
  /**
   * **这里换了一家引擎。** 和侧问一样不属于任何一轮，按时刻插进来。
   *
   * 它不是一条 item，也不进 journal：`Thread.segments` 已经记着谁在什么时候
   * 接的手，再造一条消息只会多一份要同步的真相。**更要紧的是它不是给模型看的**
   *——引擎的上下文里不该出现一句 omni 写的「你接手了」。
   */
  | { kind: "engine"; stint: EngineStint }

/**
 * 一轮花了多久，从**这一轮自己的 item** 算。
 *
 * 不从 `Turn.startedAt` 算是因为 store 只留当前那一轮，跑完就摘掉了——
 * 要让历史里每一轮都显示时长，就得再存一份完成记录。
 * 而「第一条到最后一条」本来就是用户看到的那段时间，多存一份没有换来更准。
 */
function spanOf(items: readonly Item[], turnId: string): number {
  const own = items.filter((i) => i.turnId === turnId)
  const first = own[0]
  const last = own[own.length - 1]
  if (first === undefined || last === undefined) return 0
  return Math.max(0, last.at - first.at)
}

/**
 * @param activeTurnId 正在跑的那一轮。**它不插分界线**——时长还没有定数，
 *   而底部那条常驻状态行正在实时报时。
 */
/** 这条 item 之后要不要插一条分界线。`marked` 会被就地更新——一轮只插一次。 */
function markFor(
  items: readonly Item[],
  item: Item,
  activeTurnId: string | undefined,
  marked: Set<string>,
): Row | undefined {
  if (item.kind !== "user_message") return undefined
  if (item.turnId === activeTurnId || marked.has(item.turnId)) return undefined
  marked.add(item.turnId)
  const ms = spanOf(items, item.turnId)
  // 零时长不插：那一轮只有一条提问，没有可交代的过程
  return ms > 0 ? { kind: "turn", turnId: item.turnId, ms } : undefined
}

/** 这一行属于哪一轮。三种行的归属来源不一样，抽出来免得散在调用处。 */
export function turnIdOf(row: Row): string | undefined {
  if (row.kind === "turn") return row.turnId
  if (row.kind === "edits") return row.turnId
  if (row.kind === "run") return row.items[0]?.turnId
  // 侧问**不归任何一轮**：折起某一轮时它不该跟着消失——
  // 它问的常常正是那一轮里的东西，折起来是为了少看回答，不是为了少看自己问过的话
  if (row.kind === "aside") return undefined
  // 换手分界同理，而且更硬：它标的正是两轮之间那条缝，折起谁都不该把它折掉
  if (row.kind === "engine") return undefined
  return row.item.turnId
}

/** 这一行发生在什么时候。分界线没有自己的时间（它是上一条提问的表头）。 */
function atOf(row: Row): number | undefined {
  if (row.kind === "item") return row.item.at
  if (row.kind === "edits") return undefined
  if (row.kind === "run") return row.items[row.items.length - 1]?.at
  if (row.kind === "aside") return row.aside.at
  if (row.kind === "engine") return row.stint.at
  return undefined
}

/**
 * 把「不归任何一轮」的东西按时间插进行列里。侧问与旁路共用——算法一模一样。
 *
 * **在折叠之后做**：它们不归任何一轮，折起某一轮不该把它们一起折掉。
 *
 * 位置取「第一条比它晚的行之前」——那件事发生的时候屏幕上停在哪儿，它就该留在哪儿；
 * 滚回去还能对着当时的上下文读。比所有行都晚的（发生完还没有新内容）落在队尾。
 */
function interpose<T extends { at: number }>(
  rows: readonly Row[],
  extra: readonly T[],
  make: (value: T) => Row,
): readonly Row[] {
  if (extra.length === 0) return rows
  const queue = [...extra].sort((a, b) => a.at - b.at)
  const out: Row[] = []
  let i = 0
  for (const row of rows) {
    const at = atOf(row)
    while (at !== undefined) {
      const next = queue[i]
      if (next === undefined || next.at > at) break
      out.push(make(next))
      i += 1
    }
    out.push(row)
  }
  for (const rest of queue.slice(i)) out.push(make(rest))
  return out
}

/** 侧问。 */
export function withAsides(rows: readonly Row[], asides: readonly Aside[]): readonly Row[] {
  return interpose(rows, asides, (aside) => ({ kind: "aside", aside }))
}

/**
 * 换引擎那条分界。
 *
 * ## 为什么它值一条线
 *
 * 一条会话在几家之间来回切之后，转录区是一条**看不出接缝的长流**：
 * 上面那五问是 codex 答的、下面这三问是 Claude 答的，而屏幕上一个字都没说。
 * 于是往回翻的时候人只能靠语气猜，而「这段是谁做的」恰好是换引擎之后
 * 最常问的一句——尤其是上一家出了问题、你正是为此才换的。
 *
 * ## 它只说这一句，不说别的
 *
 * 线上只有「切换至 X」。**不写「上一家的记录在哪」，也不写任何给模型的话**——
 * 前者是 `/timeline` 与「承接上一段」那颗键的事，后者根本不该存在
 *（见 `AGENTS.md`：不往模型的上下文里塞 omni 写的话）。
 */
export function withEngineMarks(
  rows: readonly Row[],
  segments: readonly EngineSegment[] | undefined,
): readonly Row[] {
  return interpose(rows, engineSwitches(segments), (stint) => ({ kind: "engine", stint }))
}

/**
 * 折起某几轮的**过程**。
 *
 * ## 折的是过程，不是答案
 *
 * 折起的那一轮只留四样：
 *
 * - **提问**：它是这一轮的表头，人是靠自己问过的话定位的；
 * - **最后一条 agent 文本**：这一轮的结论；
 * - **改动卡**：这一轮动了哪些文件；
 * - **报错**：故障不能藏——藏了，折起来的一轮看起来就像没出过事。
 *
 * 其余全是过程，一并折进去：工具组、思考、计划、已决的审批卡，以及**非最后一条**的
 * 所有 agent 文本。上一版只折工具组和思考，agent 边干边说的叙述全摊着——长会话里
 * 过程占了七成位置，折叠名存实亡。判据不变（见 `Transcript` 的 `unfolded`）：过程是给
 * 「它怎么得出这个」这个问题准备的，而多数时候你先要的是结论。还在跑的那一轮不折——
 * 那时候过程就是全部内容，它正一步步长出来。pending 的审批只可能出现在那一轮，
 * 所以折起来的轮里审批卡一定已决，藏了不丢事。
 *
 * 「最后一条」按行序取：该轮最后一个 `agent_message` 行。一轮可能一条 agent 文本
 * 都没有（全是工具调用，出错退出了）——那就没有可额外折的，行为与旧版相同。
 *
 * ## 没有分界线的那一轮**不折**
 *
 * 分界线（「已处理 1m 26s」那条）是唯一的展开入口，而它只在这一轮真花了时间时
 * 才插（`markFor`：零时长不插）。没有它还照折的话，那一轮的过程就藏得
 * **没有任何地方能点回来**——那不是折叠，是丢失。实测出图样本里所有 item
 * 共用同一个时间戳，于是整屏的工具行凭空消失，一开始还以为是渲染坏了。
 *
 * 纯函数，所以能直接测「折了以后提问和回答还在不在」「没有入口时不折」这种事。
 */
export function foldTurns(rows: readonly Row[], folded: (turnId: string) => boolean): readonly Row[] {
  const openable = new Set(rows.flatMap((row) => (row.kind === "turn" ? [row.turnId] : [])))
  // 预扫一遍，记下每轮最后一条 agent 文本的行号——后出现的覆盖先前的，
  // 留下的就是最后那条。rows 可能上千：O(n) 预扫 + O(n) 过滤，不在过滤里回查。
  const lastAnswerAt = new Map<string, number>()
  rows.forEach((row, index) => {
    if (row.kind === "item" && row.item.kind === "agent_message") lastAnswerAt.set(row.item.turnId, index)
  })
  return rows.filter((row, index) => {
    if (row.kind === "turn") return true
    const id = turnIdOf(row)
    if (id === undefined || !openable.has(id) || !folded(id)) return true
    // aside / engine 上一行就返回了（它们不归任何一轮）；走到这里只剩
    // item / run / edits：run 整组折掉，改动卡留着
    if (row.kind !== "item") return row.kind === "edits"
    // 提问是表头、报错不能藏、最后一条回答是结论，其余都是过程
    if (row.item.kind === "user_message" || row.item.kind === "error") return true
    return row.item.kind === "agent_message" && lastAnswerAt.get(id) === index
  })
}

/**
 * 一轮末尾那张「改了哪些文件」。**换轮的那一刻补上一轮的，收尾时补最后一轮的。**
 *
 * 数的是那一轮里引擎明确报成功的编辑（`reportedChangesOf`），一个文件一行、
 * 后一次覆盖前一次。一轮没改过文件就不插——空卡片比没有更吵。
 */
function editsFor(items: readonly Item[], turnId: string, cwd: string): Row | undefined {
  const edits = reportedChangesOf(items.filter((item) => item.turnId === turnId), cwd, true)
  return edits.files === 0 ? undefined : { kind: "edits", turnId, edits }
}

/**
 * 还在跑的那一轮不出卡。
 *
 * 跑到一半时这张卡是**半张账**：它此刻写着「已编辑 2 个文件」，而下一分钟
 * 可能变成五个、也可能其中一个被它自己改回去。一张会在你眼皮底下变数字的
 * 「已编辑」不是记录，是噪声——同「还在跑的那一轮不给复制」那条判据。
 */
function sealed(turnId: string, activeTurnId: string | undefined): boolean {
  return turnId !== activeTurnId
}

/**
 * @param cwd 工作区路径。**给了才插「改了哪些文件」那张卡**——
 *   引擎报的路径要按它归一，没有 cwd 就归不了（活动页那种场景就不插）。
 */
export function groupRows(items: readonly Item[], activeTurnId?: string, cwd?: string): readonly Row[] {
  const rows: Row[] = []
  const marked = new Set<string>()
  let open: string | undefined
  const seal = (turnId: string | undefined): void => {
    if (turnId === undefined || cwd === undefined || !sealed(turnId, activeTurnId)) return
    const card = editsFor(items, turnId, cwd)
    if (card !== undefined) rows.push(card)
  }
  for (const item of items) {
    // 换轮了：先把上一轮的那张卡补在它自己的末尾
    if (item.turnId !== open) {
      seal(open)
      open = item.turnId
    }
    if (item.kind !== "tool_call") {
      rows.push({ kind: "item", item })
      // 分界线插在提问**之后**：它是这一轮回答的表头，说的是「下面这些花了多久」
      const mark = markFor(items, item, activeTurnId, marked)
      if (mark !== undefined) rows.push(mark)
      continue
    }
    const last = rows[rows.length - 1]
    if (last?.kind === "run") rows[rows.length - 1] = { kind: "run", items: [...last.items, item] }
    else rows.push({ kind: "run", items: [item] })
  }
  seal(open)
  return rows
}
