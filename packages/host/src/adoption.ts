import type { Command, Thread } from "@switchback/protocol"
import { copyTranscript } from "./transcript.js"
import { drainQueued, emit, isCurrent, localeOf, type Ctx } from "./ctx.js"
import { ADOPTION } from "./adoption.messages.js"
import { rememberHandle } from "./engine-state.js"
import { launch, remove } from "./session.js"

/** 把引擎自己存的会话接进 Switchback；拿不到原文时由界面明确显示接管空态。 */
export async function adopt(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.adopt" }>,
): Promise<void> {
  const at = ctx.deps.now()
  const thread: Thread = {
    id: ctx.deps.newId("th"),
    title: cmd.title,
    cwd: cmd.cwd,
    engine: cmd.engine,
    // 不猜原生会话当初的档位；猜成更宽松的权限会越过用户授权。
    trust: "auto-edit",
    status: "starting",
    createdAt: at,
    updatedAt: at,
    engineHistory: [cmd.engine],
    engineHandle: cmd.handle,
    ...(cmd.profile === undefined ? {} : { engineProfile: cmd.profile }),
    adopted: true,
  }
  emit(ctx, { type: "thread.started", at, thread })
  let early: string | undefined
  try {
    early = await launch(ctx, thread, {
      resume: cmd.handle,
      beforeActivate: () => fillTranscript(ctx, thread),
    })
  } catch (error) {
    // adopted 不是临时缓冲：出生事件已经进 journal。失败时必须走完整删除，
    // 只发 removed 会让它重启后从磁盘变成一条幽灵历史。
    if (!ctx.removed.has(thread.id)) {
      await remove(ctx, { type: "thread.delete", threadId: thread.id })
    }
    throw error
  }
  if (ctx.removed.has(thread.id)) return
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
  // 历史已在实时流激活前搬完；否则原生主动轮可能抢先插到旧记录前面。
  if (ctx.removed.has(thread.id)) return
  const entry = ctx.live.get(thread.id)
  if (entry === undefined || !isCurrent(ctx, entry)) return
  const readyAt = ctx.deps.now()
  entry.thread = {
    ...entry.thread,
    status: entry.turn === undefined ? "idle" : "running",
    updatedAt: readyAt,
  }
  emit(ctx, { type: "thread.updated", at: readyAt, thread: entry.thread })
  drainQueued(ctx, entry)
}

/** 能搬多少原生记录就搬多少；截断时必须告诉用户完整内容仍在引擎侧。 */
async function fillTranscript(ctx: Ctx, thread: Thread): Promise<void> {
  const entry = ctx.live.get(thread.id)
  const read = entry?.session.transcript
  if (entry === undefined || read === undefined) return
  const got = await read.call(entry.session).catch(() => undefined)
  if (!isCurrent(ctx, entry) || got === undefined || got.items.length === 0) return
  copyTranscript(ctx, thread, got.items)
  if (got.total <= got.items.length) return
  ctx.deps.emit({
    type: "engine.status",
    at: ctx.deps.now(),
    threadId: thread.id,
    status: "degraded",
    detail: ADOPTION[localeOf(ctx)].trimmed(got.total, got.items.length),
  })
}
