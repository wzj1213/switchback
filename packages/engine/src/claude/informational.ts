import type { Event, ItemId, NoticeItem, NoticeLevel, TurnId } from "@omni/protocol"

interface RawInformational {
  content?: unknown
  level?: unknown
  tool_use_id?: unknown
}

interface InformationalContext {
  turnId: TurnId
  at: number
  nextId: () => ItemId
  emit: (event: Event) => void
}

const NOTICE_LEVELS: readonly NoticeLevel[] = ["info", "notice", "suggestion", "warning"]

/**
 * Claude 明确要求 SDK 宿主展示的纯文本横幅。
 *
 * 不能伪装成 agent_message：它不是模型说的话；也不能塞进 ErrorItem：SDK 明说这里
 * 包含非错误状态与 slash 输出。tool_use_id 则按契约把同一工具的进度就地更新。
 */
export function emitInformational(
  msg: RawInformational,
  notices: Map<string, NoticeItem>,
  ctx: InformationalContext,
): void {
  if (typeof msg.content !== "string" || msg.content === "") return
  if (!NOTICE_LEVELS.includes(msg.level as NoticeLevel)) return
  const toolUseId = typeof msg.tool_use_id === "string" ? msg.tool_use_id : undefined
  const previous = toolUseId === undefined ? undefined : notices.get(toolUseId)
  if (previous !== undefined) {
    ctx.emit({
      type: "item.updated",
      at: ctx.at,
      item: { ...previous, message: msg.content, level: msg.level as NoticeLevel },
    })
    return
  }
  const item: NoticeItem = {
    id: ctx.nextId(),
    turnId: ctx.turnId,
    at: ctx.at,
    kind: "notice",
    message: msg.content,
    level: msg.level as NoticeLevel,
  }
  if (toolUseId !== undefined) notices.set(toolUseId, item)
  ctx.emit({ type: "item.started", at: ctx.at, item })
}
