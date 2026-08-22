import type { ApprovalAsk } from "@omni/engine"
import type { Event, ItemId, TurnId } from "@omni/protocol"

/**
 * 引擎给的 item id 只保证在它自己的原生会话里可引用，不能直接当 omni 全局 id。
 * 一条 omni 会话会中途换引擎；两家都报 `c1` 时，store 会把后一条当更新覆盖前一条。
 */
export interface ItemScope {
  event: (event: Event) => Event
  ask: (ask: ApprovalAsk, turnId: TurnId | undefined) => ApprovalAsk
}

export function createItemScope(newId: (prefix: string) => ItemId): ItemScope {
  const byTurn = new Map<TurnId, Map<ItemId, ItemId>>()
  const latest = new Map<ItemId, ItemId>()

  const idOf = (turnId: TurnId, native: ItemId): ItemId => {
    const turn = byTurn.get(turnId) ?? new Map<ItemId, ItemId>()
    if (!byTurn.has(turnId)) byTurn.set(turnId, turn)
    const known = turn.get(native)
    if (known !== undefined) return known
    const scoped = newId("it")
    turn.set(native, scoped)
    latest.set(native, scoped)
    return scoped
  }

  return {
    event: (event) => {
      if (event.type === "item.delta") {
        const itemId = latest.get(event.itemId)
        return itemId === undefined ? event : { ...event, itemId }
      }
      if (event.type !== "item.started" && event.type !== "item.updated") return event
      const id = idOf(event.item.turnId, event.item.id)
      latest.set(event.item.id, id)
      return { ...event, item: { ...event.item, id } }
    },
    ask: (ask, turnId) =>
      turnId === undefined ? ask : { ...ask, toolCallId: idOf(turnId, ask.toolCallId) },
  }
}
