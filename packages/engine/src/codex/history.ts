import type { Item } from "@omni/protocol"
import { itemToOmni, textOf } from "./translate.js"
import type { WireItem, WireTurnStatus } from "./wire.js"

/** `thread/resume` 里随 thread 返回的公开历史窄声明。 */
export interface CodexHistoryTurn {
  id?: string
  items?: readonly CodexHistoryItem[]
  itemsView?: "notLoaded" | "summary" | "full"
  status?: WireTurnStatus
  error?: { message?: string } | null
  startedAt?: number | null
  completedAt?: number | null
}

export interface CodexHistoryThread {
  id?: string
  path?: string | null
  turns?: readonly CodexHistoryTurn[]
}

interface WireUserInput {
  type?: string
  text?: string
  path?: string
}

interface WireUserMessage extends Omit<WireItem, "content"> {
  content?: readonly WireUserInput[]
}

type CodexHistoryItem = WireItem | WireUserMessage

/** 与 Claude 历史同一上限；留最近的可见记录，避免把几十 MB 原样复制进 journal。 */
const ITEM_MAX = 1500

function millis(raw: number | null | undefined, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw * 1000 : fallback
}

function historyId(raw: string | undefined, fallback: string): string {
  return raw === undefined || raw === "" ? fallback : raw
}

function userMessage(
  item: WireUserMessage,
  turnId: string,
  at: number,
  fallbackId: string,
): Item | undefined {
  const content = item.content ?? []
  const text = content
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text ?? "")
    .join("\n")
  const attachments = content
    .filter((entry) => entry.type === "localImage" && typeof entry.path === "string")
    .map((entry) => entry.path ?? "")
  if (text.trim() === "" && attachments.length === 0) return undefined
  return {
    id: historyId(item.id, fallbackId),
    turnId,
    at,
    kind: "user_message",
    text,
    ...(attachments.length === 0 ? {} : { attachments }),
  }
}

function visibleItem(
  item: CodexHistoryItem,
  turnId: string,
  at: number,
  fallbackId: string,
): Item | undefined {
  if (item.type === "hookPrompt" || item.type === "subAgentActivity") return undefined
  if (item.type === "userMessage")
    return userMessage(item as WireUserMessage, turnId, at, fallbackId)
  const wire = item as WireItem
  if ((wire.type === "agentMessage" || wire.type === "reasoning") && textOf(wire).trim() === "") {
    return undefined
  }
  return itemToOmni({ ...wire, id: historyId(wire.id, fallbackId) }, { turnId, at }, true)
}

function failedItem(turn: CodexHistoryTurn, turnId: string, at: number): Item | undefined {
  const message = turn.error?.message?.trim() ?? ""
  if (turn.status !== "failed" || message === "") return undefined
  return { id: `history-error-${turnId}`, turnId, at, kind: "error", message, fatal: true }
}

/**
 * `thread/resume.thread.turns` → 接管 transcript。
 *
 * app-server 0.149.0 明确保留了一条兼容路径：未传 `excludeTurns` 时 resume 会逐页
 * 取齐所有 turn/item，并将 `itemsView` 标为 full。这里只翻译它已经公开返回的内容，
 * 不读 rollout，也不从模型上下文反推历史。
 */
export function toCodexTranscript(
  thread: CodexHistoryThread | undefined,
  now: number,
): { items: readonly Item[]; total: number } {
  const turns = thread?.turns ?? []
  // 旧协议可能省略 itemsView（其 serde 默认就是 full）；明确说 summary/notLoaded 时
  // 宁可让接管空态如实说明没拿到正文，也不拿一份摘要冒充完整 transcript。
  if (turns.some((turn) => turn.itemsView !== undefined && turn.itemsView !== "full")) {
    return { items: [], total: 0 }
  }
  const all: Item[] = []
  for (const [turnIndex, turn] of turns.entries()) {
    const turnId = historyId(turn.id, `history-turn-${String(turnIndex)}`)
    const at = millis(turn.startedAt, now)
    for (const [itemIndex, item] of (turn.items ?? []).entries()) {
      const mapped = visibleItem(
        item,
        turnId,
        at,
        `history-item-${String(turnIndex)}-${String(itemIndex)}`,
      )
      if (mapped !== undefined) all.push(mapped)
    }
    const error = failedItem(turn, turnId, millis(turn.completedAt, at))
    if (error !== undefined) all.push(error)
  }
  return { items: all.length > ITEM_MAX ? all.slice(-ITEM_MAX) : all, total: all.length }
}
