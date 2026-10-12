import type { ThreadId } from "@switchback/protocol"
import type { Replay, Sealed } from "@switchback/wire"

/**
 * 远程模式里，哪些会话的正文**还在路上**、哪些**被裁过**。
 *
 * ## 为什么要记
 *
 * 宿主给远程的全量是分级的（`main/scope.ts`）：预算之外的会话只发头，打开时才单独补
 *（`watch` → `thread` 帧）。补到之前那条会话的正文是空的——而桌面界面对一条空会话说的是
 * 「开始在 X 中工作」。**那是一句确定的假话**：会话明明有内容，只是还没到。
 * 被裁过的同理：只带了尾巴，界面上不说的话人会以为记录丢了。
 *
 * ## 判据
 *
 * - 全量没带 `bodies`（不分级）→ 全都算到了。
 * - 带了 → 名单里的到了；之后单独补到的到了；**全量之后新开的**（增量里的 `thread.started`）
 *   也算到了——它的正文从头就走事件流，不存在「还没补」这回事。
 */
export interface Bodies {
  replayed: (replay: Replay) => void
  saw: (sealed: readonly Sealed[]) => void
  loaded: (threadId: ThreadId, trimmed: boolean) => void
  pending: (threadId: ThreadId) => boolean
  trimmed: (threadId: ThreadId) => boolean
  /** 给 `useSyncExternalStore`：变了就通知、版本号跟着涨。 */
  subscribe: (listener: () => void) => () => void
  version: () => number
}

export function createBodies(): Bodies {
  const state = {
    tiered: false,
    loaded: new Set<ThreadId>(),
    trimmed: new Set<ThreadId>(),
    version: 0,
    listeners: new Set<() => void>(),
  }
  const changed = (): void => {
    state.version += 1
    for (const listener of state.listeners) listener()
  }
  return {
    replayed: (replay) => {
      state.tiered = replay.bodies !== undefined
      state.loaded = new Set(replay.bodies ?? [])
      state.trimmed = new Set(replay.trimmed ?? [])
      changed()
    },
    saw: (sealed) => {
      const started = sealed.flatMap((one) => (one.event.type === "thread.started" ? [one.event.thread.id] : []))
      if (started.length === 0) return
      for (const id of started) state.loaded.add(id)
      changed()
    },
    loaded: (threadId, trimmed) => {
      state.loaded.add(threadId)
      // 补来的那一份可能是完整的（这次没超限），那就把旧的标记撤掉
      if (trimmed) state.trimmed.add(threadId)
      else state.trimmed.delete(threadId)
      changed()
    },
    pending: (threadId) => state.tiered && !state.loaded.has(threadId),
    trimmed: (threadId) => state.trimmed.has(threadId),
    subscribe: (listener) => {
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
      }
    },
    version: () => state.version,
  }
}
