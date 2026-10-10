import type { PendingApproval, Thread } from "@switchback/protocol"
import type { ApprovalAnswer, ApprovalAsk, InteractionWait } from "@switchback/engine"
import { emit, isCurrent, type Ctx, type Live } from "./ctx.js"

/**
 * 主轮之外来的权限请求：后台子 agent、workflow 在主轮收工之后才来要权限。
 *
 * 以前一律按拒绝落定（`unattended`）。可引擎自己——Claude CLI、Kimi——都让这类请求一直等人，
 * Switchback 先拒，等于替引擎改了它的行为。现在挂在会话上（`Thread.pendingApprovals`），
 * 输入框上方列出来等人点，不设超时。主轮收工、按停止都不收它（`gate.settleTurn`）；
 * 背后的进程要走了（关会话、换引擎、改档重启、被收起）才统一收掉（`gate.settleAll`）。
 *
 * **不改会话状态**：`waiting_approval` 在界面上等于「这一轮还在跑」（停止键、输入框的忙碌态都认它），
 * 而此时并没有轮次在跑。侧栏、列表上的「待批」由 `@switchback/store` 的 `displayStatus` 另外判。
 */
export function askOutside(ctx: Ctx, entry: Live, ask: ApprovalAsk, wait: InteractionWait | undefined): Promise<ApprovalAnswer> {
  const itemId = ctx.deps.newId("ap")
  const at = ctx.deps.now()
  if (ask.suggest !== undefined) entry.suggests.set(itemId, ask.suggest)
  const answer = entry.gate.hold(itemId, () => {
    clearOutside(ctx, entry, itemId)
  })
  entry.thread = {
    ...entry.thread,
    pendingApprovals: [...(entry.thread.pendingApprovals ?? []), card(itemId, ask, at)],
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  const abort = (): void => {
    entry.gate.cancelApproval(itemId)
  }
  if (wait?.signal?.aborted === true) abort()
  else wait?.signal?.addEventListener("abort", abort, { once: true })
  return answer.finally(() => {
    wait?.signal?.removeEventListener("abort", abort)
    entry.suggests.delete(itemId)
  })
}

function card(id: string, ask: ApprovalAsk, at: number): PendingApproval {
  return {
    id, tool: ask.tool, summary: ask.summary, reason: ask.reason, at,
    ...(ask.rememberHint === undefined ? {} : { rememberHint: ask.rememberHint }),
    ...(ask.redline === undefined ? {} : { redline: true }),
    ...(ask.origin === undefined ? {} : { origin: ask.origin }),
  }
}

export function withoutOutside(thread: Thread, itemId: string, at: number): Thread {
  const rest = (thread.pendingApprovals ?? []).filter((one) => one.id !== itemId)
  const next = { ...thread, updatedAt: at }
  delete next.pendingApprovals
  return rest.length === 0 ? next : { ...next, pendingApprovals: rest }
}

function clearOutside(ctx: Ctx, entry: Live, itemId: string): void {
  if (!(entry.thread.pendingApprovals ?? []).some((one) => one.id === itemId)) return
  const at = ctx.deps.now()
  entry.thread = withoutOutside(entry.thread, itemId, at)
  // 换引擎、改档重启时旧条目已经让位：新条目上本来就没有这几项，别拿旧条目的快照去盖它
  if (isCurrent(ctx, entry)) emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** 这张卡是不是主轮之外来的（落定时「本轮剩下的都放行」不适用）。 */
export function isOutside(entry: Live, itemId: string): boolean {
  return (entry.thread.pendingApprovals ?? []).some((one) => one.id === itemId)
}

