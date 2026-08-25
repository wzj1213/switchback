import type { Event, ItemId, ThreadId, TurnId } from "@omni/protocol"

interface RawConversationReset {
  new_conversation_id?: unknown
}

interface ResetContext {
  threadId: ThreadId
  turnId?: TurnId
  at: number
  nextId?: () => ItemId
  emit: (event: Event) => void
}

/**
 * `/clear` 不删除 omni 的历史：一条 omni 会话本来就能跨多个原生 segment。
 * 但必须留下明确分界，并清掉已经不属于新 Claude 上下文的用量。
 * 新的可续跑 session id 不在这条消息里，而在紧随其后的 result 上；见 loop.ts。
 */
export function emitConversationReset(raw: unknown, ctx: ResetContext): void {
  if (typeof raw !== "object" || raw === null) return
  const reset = raw as RawConversationReset
  if (typeof reset.new_conversation_id !== "string" || reset.new_conversation_id === "") return
  ctx.emit({ type: "usage.cleared", at: ctx.at, threadId: ctx.threadId, engine: "claude" })
  if (ctx.turnId === undefined || ctx.nextId === undefined) return
  ctx.emit({
    type: "item.started",
    at: ctx.at,
    item: {
      id: ctx.nextId(),
      turnId: ctx.turnId,
      at: ctx.at,
      kind: "notice",
      level: "notice",
      message: "Claude 已清空上下文；上方记录仍保留供你查看，但后续回答不会再读取它。",
    },
  })
}
