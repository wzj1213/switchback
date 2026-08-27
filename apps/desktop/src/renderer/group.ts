import type { Aside, Item, Lane, ToolCallItem } from "@omni/protocol"
import { reportedChangesOf, type Changes } from "./changes.js"

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
   * 一条旁路（子 agent、编排进度）。**同样不属于任何一轮**，也不在 `items` 里——
   * 它在 store 的 `lanes` 表上，由 `withLanes` 按时间插进来。
   *
   * workflow 恰恰是**主循环收工之后**才跑起来的，所以它一定落在某条分界线之后；
   * 按 `Lane.at`（出生时刻）插，位置就是「你起这一批的时候屏幕停在哪儿」。
   */
  | { kind: "lane"; lane: Lane }
  /**
   * 一轮改了哪些文件，跟在那一轮的末尾。**每轮一张，不是整条会话一张**——
   * 为什么，见 `components/TurnEdits.tsx` 开头。
   */
  | { kind: "edits"; turnId: string; edits: Changes }

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
  // 侧问与旁路**都不归任何一轮**：折起某一轮时它们不该跟着消失——侧问问的常常正是
  // 那一轮里的东西；而 workflow 是主循环收工之后才跑起来的，本来就不在任何一轮里
  if (row.kind === "aside" || row.kind === "lane") return undefined
  return row.item.turnId
}

/** 这一行发生在什么时候。分界线没有自己的时间（它是上一条提问的表头）。 */
function atOf(row: Row): number | undefined {
  if (row.kind === "item") return row.item.at
  if (row.kind === "edits") return undefined
  if (row.kind === "run") return row.items[row.items.length - 1]?.at
  if (row.kind === "aside") return row.aside.at
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

/** 旁路。**排在侧问之后插**，两者都不归轮次，谁先谁后只影响同一毫秒时的并列顺序。 */
export function withLanes(rows: readonly Row[], lanes: readonly Lane[]): readonly Row[] {
  return interpose(rows, lanes, (lane) => ({ kind: "lane", lane }))
}

/**
 * 折起某几轮的**回答**。
 *
 * 折的是分界线**之后**、属于同一轮的东西——提问本身永远留着。
 * 一个折了三轮的 transcript 如果连问题也看不见，那就不是「折叠」，是「清空」：
 * 人是靠自己问过的那句话来定位「我要找的是哪一段」的。
 *
 * 纯函数，所以能直接测「折了以后提问还在不在」这种事。
 */
export function foldTurns(rows: readonly Row[], collapsed: ReadonlySet<string>): readonly Row[] {
  const hiding = new Set<string>()
  const out: Row[] = []
  for (const row of rows) {
    const id = turnIdOf(row)
    if (row.kind === "turn" && collapsed.has(row.turnId)) {
      hiding.add(row.turnId)
      out.push(row)
      continue
    }
    if (id !== undefined && hiding.has(id)) continue
    out.push(row)
  }
  return out
}

/**
 * 一轮末尾那张「改了哪些文件」。**换轮的那一刻补上一轮的，收尾时补最后一轮的。**
 *
 * 数的是那一轮里引擎明确报成功的编辑（`reportedChangesOf`），一个文件一行、
 * 后一次覆盖前一次。一轮没改过文件就不插——空卡片比没有更吵。
 */
function editsFor(items: readonly Item[], turnId: string, cwd: string): Row | undefined {
  const edits = reportedChangesOf(items.filter((item) => item.turnId === turnId), cwd)
  return edits.files === 0 ? undefined : { kind: "edits", turnId, edits }
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
    if (turnId === undefined || cwd === undefined) return
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
