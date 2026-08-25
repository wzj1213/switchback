import type { Event, ItemId, TurnId } from "@omni/protocol"

interface RawLocalCommandOutput {
  content?: unknown
}

interface LocalCommandContext {
  turnId: TurnId
  at: number
  nextId: () => ItemId
  emit: (event: Event) => void
}

/** Claude 明确要求 SDK renderer 作为助手样式文本展示的本地斜杠命令结果。 */
export function emitLocalCommandOutput(msg: RawLocalCommandOutput, ctx: LocalCommandContext): void {
  if (typeof msg.content !== "string" || msg.content === "") return
  ctx.emit({
    type: "item.started",
    at: ctx.at,
    item: {
      id: ctx.nextId(),
      turnId: ctx.turnId,
      at: ctx.at,
      kind: "agent_message",
      text: msg.content,
      complete: true,
    },
  })
}
