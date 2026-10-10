import type { Command, Thread } from "@switchback/protocol"
import { emit, isCurrent, type Ctx, type Live } from "./ctx.js"
import { withQueue } from "./queued.js"
import { rememberHandle } from "./engine-state.js"
import { launch } from "./session.js"
import { carryRules } from "./approval.js"
import { updateRecord } from "./revive.js"
import { withoutPending } from "./switched.js"

async function attach(ctx: Ctx, thread: Thread, resume: string | undefined): Promise<Live> {
  // 权限重启仍是同一段对话，只能复用原基线，不能以重启时刻重置差异。
  const early = await launch(ctx, thread, {
    ...(resume === undefined ? {} : { resume }),
    captureBaseline: false,
  })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
  const current = ctx.live.get(thread.id)
  if (current === undefined) throw new Error("权限档重启后会话没有重新接入")
  return current
}

function takeQueue(from: Live, into: Live): void {
  into.queued = [...from.queued]
  carryRules(from, into)
  into.thread = {
    ...withQueue(into.thread, into.queued),
    title: from.thread.title,
    draft: from.thread.draft,
    draftAttachments: from.thread.draftAttachments,
    draftRevision: from.thread.draftRevision,
    ...(from.thread.named === true ? { named: true } : {}),
    ...(from.thread.segments === undefined ? {} : { segments: from.thread.segments }),
  }
  void into.session.setTitle?.(into.thread.title).catch(() => undefined)
}

async function rollback(
  ctx: Ctx,
  entry: Live,
  state: { previous: Thread; resume?: string; cause: unknown; held: boolean },
): Promise<never> {
  const { resume, cause, held } = state
  const previous = withoutPending(state.previous)
  if (ctx.closed || ctx.removed.has(previous.id)) throw cause
  const restored = await attach(ctx, previous, resume).catch(() => undefined)
  const at = ctx.deps.now()
  if (restored === undefined) {
    ctx.live.delete(previous.id)
    emit(ctx, {
      type: "thread.updated",
      at,
      thread: {
        ...withQueue(previous, entry.queued, at),
        title: entry.thread.title,
        draft: entry.thread.draft,
        draftAttachments: entry.thread.draftAttachments,
        draftRevision: entry.thread.draftRevision,
        ...(entry.thread.named === true ? { named: true } : {}),
        ...(entry.thread.segments === undefined ? {} : { segments: entry.thread.segments }),
        detached: true,
        status: "failed",
      },
    })
    throw cause
  }
  takeQueue(entry, restored)
  emit(ctx, { type: "thread.updated", at, thread: restored.thread })
  if (!held && restored.queued.length > 0) ctx.drain?.(previous.id)
  throw cause
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
  // 重启前就排着的是上一轮失败留下的「待发送」：等人取回或下一轮跑完，不跟着重启发出去
  const held = entry.queued.length > 0
  const next: Thread = { ...withoutPending(previous), trust, status: "starting", updatedAt: at }
  entry.thread = { ...previous, status: "starting", updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  entry.gate.settleAll()
  entry.lease.active = false
  await entry.session.dispose().catch(() => undefined)
  let current: Live
  try {
    current = await attach(ctx, next, resume)
  } catch (error) {
    return rollback(ctx, entry, {
      previous,
      ...(resume === undefined ? {} : { resume }),
      cause: error,
      held,
    })
  }
  takeQueue(entry, current)
  const readyAt = ctx.deps.now()
  current.thread = {
    ...current.thread,
    trust,
    status: current.turn === undefined ? "idle" : "running",
    trustApply: { result: "applied", at: readyAt },
    updatedAt: readyAt,
  }
  emit(ctx, { type: "thread.updated", at: readyAt, thread: current.thread })
  if (!held && current.queued.length > 0) ctx.drain?.(previous.id)
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
    if (!isCurrent(ctx, entry)) return
    const previous = entry.thread.trust
    const result = await entry.session.setTrust(cmd.trust)
    if (!isCurrent(ctx, entry)) return
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

/**
 * 历史会话只改落盘记录；下次接回时按新档位开原生进程（见 `revive.ts`）。
 * 网页端「先降档再接回」靠的就是这一条。
 */
function updateDetached(ctx: Ctx, cmd: Extract<Command, { type: "thread.setTrust" }>): Promise<void> {
  return updateRecord(ctx, cmd.threadId, (thread) => ({ ...thread, trust: cmd.trust }))
}
