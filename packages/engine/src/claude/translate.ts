import type { Item, ItemId, ToolDetail, TurnId } from "@omni/protocol"

/**
 * Claude 内容块的**结构性**最小类型。
 *
 * 有意不 import SDK 的 `BetaContentBlock` 联合：那个联合有几十个成员且随版本变动，
 * 直接依赖会让驱动每次 SDK 升级都编译不过。这里只声明我们真正读的字段，
 * 认不出的块统一落 `tool_call/other`。
 */
interface RawBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

const strOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

/**
 * Claude 工具名 → 渲染形态。表驱动而非 switch：新增工具只改表，
 * 且不会把 `toolDetail` 的圈复杂度推过闸门。
 */
const TOOL_KIND: Readonly<Record<string, ToolDetail["kind"]>> = {
  Bash: "shell",
  Read: "file_read",
  NotebookRead: "file_read",
  Write: "file_edit",
  Edit: "file_edit",
  MultiEdit: "file_edit",
  NotebookEdit: "file_edit",
  WebFetch: "fetch",
}

/** 认不出的工具落 `other`，原始参数原样带上供 UI 兜底展示。 */
export function toolDetail(name: string, input: Record<string, unknown>): ToolDetail {
  switch (TOOL_KIND[name]) {
    case "shell":
      return { kind: "shell", command: strOf(input["command"]) ?? "" }
    case "file_read":
      return { kind: "file_read", path: strOf(input["file_path"]) ?? "" }
    case "file_edit":
      return { kind: "file_edit", path: strOf(input["file_path"]) ?? "", added: 0, removed: 0 }
    case "fetch":
      return { kind: "fetch", url: strOf(input["url"]) ?? "" }
    default:
      return { kind: "other", name, input }
  }
}

export interface TranslateContext {
  turnId: TurnId
  at: number
  /** ID 由宿主铸造——本包不生成，方便测试确定化 */
  nextId: () => ItemId
}

function blockToItem(block: RawBlock, ctx: TranslateContext): Item | undefined {
  const base = { id: ctx.nextId(), turnId: ctx.turnId, at: ctx.at }
  switch (block.type) {
    case "text":
      return { ...base, kind: "agent_message", text: block.text ?? "", complete: true }
    case "thinking":
      return { ...base, kind: "reasoning", text: block.thinking ?? "", complete: true }
    case "tool_use":
      return {
        ...base,
        // 复用 Claude 的 tool_use id：审批回调回来时要靠它把审批卡挂到对的调用下
        id: block.id ?? base.id,
        kind: "tool_call",
        tool: block.name ?? "unknown",
        status: "running",
        detail: toolDetail(block.name ?? "unknown", block.input ?? {}),
      }
    default:
      return undefined
  }
}

/** 一条 assistant 消息 → 零到多个 item。认不出的块直接丢，不进 transcript。 */
export function assistantItems(
  content: readonly unknown[],
  ctx: TranslateContext,
): readonly Item[] {
  const items: Item[] = []
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue
    const item = blockToItem(raw as RawBlock, ctx)
    if (item !== undefined) items.push(item)
  }
  return items
}

/** SDK 的 result 消息 → turn 终态。`is_error` 优先于 `subtype`。 */
export function turnStatus(subtype: string, isError: boolean): "completed" | "failed" | "interrupted" {
  if (isError) return "failed"
  return subtype === "success" ? "completed" : "interrupted"
}
