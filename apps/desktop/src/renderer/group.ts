import type { Item, ToolCallItem } from "@omni/protocol"

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
  if (row.kind === "run") return row.items[0]?.turnId
  return row.item.turnId
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

export function groupRows(items: readonly Item[], activeTurnId?: string): readonly Row[] {
  const rows: Row[] = []
  const marked = new Set<string>()
  for (const item of items) {
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
  return rows
}
