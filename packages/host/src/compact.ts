import type { Command } from "@omni/protocol"
import { emit, isCurrent, setStatus, type Ctx } from "./ctx.js"

/**
 * 压缩本身也是一段有起止的引擎工作：否则异步完成通知没有宿主 turn 可归属，
 * `/compact` 会在界面上一声不响，期间还可能误放下一条 prompt 进去撞 busy。
 */
export async function compact(
  ctx: Ctx,
  command: Extract<Command, { type: "thread.compact" }>,
): Promise<void> {
  const entry = ctx.live.get(command.threadId)
  if (entry === undefined || !entry.lease.active || entry.session.compact === undefined) return
  if (entry.turn !== undefined) throw new Error("这一轮还在跑，压缩要等它停下来")

  const at = ctx.deps.now()
  const turnId = ctx.deps.newId("tn")
  entry.turn = turnId
  setStatus(ctx, entry, "running")
  emit(ctx, {
    type: "turn.started",
    at,
    turn: {
      id: turnId,
      threadId: command.threadId,
      engine: entry.thread.engine,
      status: "running",
      startedAt: at,
    },
  })

  try {
    await entry.session.compact(turnId)
  } catch (error) {
    if (isCurrent(ctx, entry) && entry.turn === turnId) {
      entry.turn = undefined
      setStatus(ctx, entry, "failed")
      emit(ctx, {
        type: "turn.completed",
        at: ctx.deps.now(),
        turnId,
        status: "failed",
        error: String(error),
      })
    }
    throw error
  }
}
