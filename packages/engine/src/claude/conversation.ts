import type { Event, ItemId, ThreadId, TurnId } from "@switchback/protocol"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CLAUDE_CONVERSATION } from "./conversation.messages.js"

interface RawConversationReset {
  new_conversation_id?: unknown
}

interface ResetContext {
  threadId: ThreadId
  turnId?: TurnId
  at: number
  nextId?: () => ItemId
  emit: (event: Event) => void
  locale?: () => Locale
}

/**
 * `/clear` 不删除 Switchback 的历史：一条 Switchback 会话本来就能跨多个原生 segment。
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
      message: CLAUDE_CONVERSATION[localeOf(ctx)].cleared,
    },
  })
}
