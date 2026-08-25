import type { NativeTurnStart } from "@omni/engine"
import { emit, isCurrent, setStatus, type Ctx, type Live } from "./ctx.js"
import { recordSegment } from "./segment.js"

/** 原生主动轮让临时会话转正，但不能吃掉用户仍在编辑的草稿。 */
function commitNative(ctx: Ctx, entry: Live, at: number): void {
  if (entry.thread.provisional !== true) return
  const thread = { ...entry.thread, updatedAt: at }
  delete thread.provisional
  entry.thread = thread
  emit(ctx, { type: "thread.updated", at, thread })
}

/**
 * 把引擎已经开启的一轮接进宿主主线。返回值同步交回驱动绑定后续原生事件。
 */
export function beginNativeTurn(
  ctx: Ctx,
  entry: Live,
  request: NativeTurnStart,
): string | undefined {
  if (!isCurrent(ctx, entry) || entry.turn !== undefined) return undefined
  const { at, prompt, origin } = request
  commitNative(ctx, entry, at)
  void recordSegment(ctx, entry)
  const turnId = ctx.deps.newId("tn")
  entry.turn = turnId
  setStatus(ctx, entry, "running")
  emit(ctx, {
    type: "turn.started",
    at,
    turn: {
      id: turnId,
      threadId: entry.thread.id,
      engine: entry.thread.engine,
      status: "running",
      startedAt: at,
    },
  })
  emit(ctx, {
    type: "item.started",
    at,
    item: {
      id: ctx.deps.newId("it"),
      turnId,
      kind: "user_message",
      at,
      text: prompt,
      ...(origin === undefined ? {} : { origin }),
    },
  })
  return turnId
}
