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

export function groupRows(items: readonly Item[]): readonly Row[] {
  const rows: Row[] = []
  for (const item of items) {
    if (item.kind !== "tool_call") {
      rows.push({ kind: "item", item })
      continue
    }
    const last = rows[rows.length - 1]
    if (last?.kind === "run") rows[rows.length - 1] = { kind: "run", items: [...last.items, item] }
    else rows.push({ kind: "run", items: [item] })
  }
  return rows
}
