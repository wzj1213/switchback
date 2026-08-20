import type { Command, Event, Thread } from "@omni/protocol"
import { emit, type Ctx, type Live } from "./ctx.js"
import { rememberHandle } from "./engine-state.js"
import { launch } from "./session.js"

async function attach(ctx: Ctx, thread: Thread, resume: string | undefined): Promise<void> {
  const early = await launch(ctx, thread, resume)
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
}

/** 原生权限开关固定时，续接同一条引擎会话重启；不丢 transcript，也不另开上下文。 */
async function restart(ctx: Ctx, entry: Live, trust: Thread["trust"]): Promise<void> {
  const previous = entry.thread
  const resume = previous.engineHandle
  if (resume === undefined && previous.provisional !== true) {
    await entry.session.setTrust(previous.trust)
    throw new Error("这条会话没有引擎句柄，无法在保留上下文的前提下重启权限沙箱")
  }
  const at = ctx.deps.now()
  const next: Thread = { ...previous, trust, updatedAt: at }
  entry.gate.settleAll()
  ctx.live.delete(previous.id)
  await entry.session.dispose().catch(() => undefined)
  try {
    await attach(ctx, next, resume)
  } catch (error) {
    await attach(ctx, previous, resume).catch(() => undefined)
    const restored = ctx.live.get(previous.id)
    if (restored !== undefined) emit(ctx, { type: "thread.updated", at, thread: restored.thread })
    throw error
  }
  const current = ctx.live.get(previous.id)
  if (current === undefined) throw new Error("权限档重启后会话没有重新接入")
  current.thread = {
    ...current.thread,
    trust,
    trustApply: { result: "applied", at },
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: current.thread })
}

/**
 * 活会话优先原地应用；Codex 这类开场固定的原生沙箱在空闲时自动续接重启。
 * 正在跑时不打断任务，也不留下一个界面已换、原生未换的假状态。
 */
export async function setTrust(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.setTrust" }>,
): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry !== undefined) {
    const previous = entry.thread.trust
    const result = await entry.session.setTrust(cmd.trust)
    if (result.restart) {
      if (entry.turn !== undefined) {
        await entry.session.setTrust(previous)
        throw new Error(result.detail)
      }
      await restart(ctx, entry, cmd.trust)
      return
    }
    const at = ctx.deps.now()
    entry.thread = { ...entry.thread, trust: cmd.trust, updatedAt: at }
    emit(ctx, { type: "thread.updated", at, thread: entry.thread })
    return
  }
  await updateDetached(ctx, cmd)
}

/** 历史会话只改落盘记录；下次 resume 会按新档位开原生进程。 */
async function updateDetached(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.setTrust" }>,
): Promise<void> {
  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const record = [...events]
    .reverse()
    .find(
      (event): event is Extract<Event, { type: "thread.started" | "thread.updated" }> =>
        event.type === "thread.started" || event.type === "thread.updated",
    )
  if (record === undefined) return
  const at = ctx.deps.now()
  emit(ctx, {
    type: "thread.updated",
    at,
    thread: { ...record.thread, trust: cmd.trust, updatedAt: at },
  })
}
