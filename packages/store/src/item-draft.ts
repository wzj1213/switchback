import type { Item, ItemId, ThreadId } from "@omni/protocol"
import type { ViewState } from "./state.js"

interface ItemList {
  items: Item[]
  index: Map<ItemId, number>
}

/** 只活在一次 reduceAll 内；首次碰到某条会话才复制，返回前不暴露中间态。 */
export interface Draft {
  owner: Record<ItemId, ThreadId>
  lists: Map<ThreadId, ItemList>
}

export function draftList(state: ViewState, threadId: ThreadId, draft: Draft): ItemList {
  const source = state.items[threadId]
  const cached = draft.lists.get(threadId)
  if (cached !== undefined && cached.items === source) return cached
  // 删除消息、删除会话或新轮次可能换掉数组；以引用核对，不能复用旧位置表。
  const items = [...(source ?? [])]
  const next = { items, index: new Map(items.map((item, at) => [item.id, at])) }
  draft.lists.set(threadId, next)
  return next
}

export function appendDraft(state: ViewState, threadId: ThreadId, item: Item, draft: Draft): Item[] {
  const list = draftList(state, threadId, draft)
  const at = list.index.get(item.id) ?? list.items.length
  list.index.set(item.id, at)
  list.items[at] = item
  return list.items
}
