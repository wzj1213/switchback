import type { ThreadId } from "@switchback/protocol"
import { emit, isCurrent, resting, type Ctx, type Live } from "./ctx.js"

/**
 * **同时活着几条引擎会话，谁该被收掉。**
 *
 * 和「命令怎么执行」是两件事：这里管的是资源压力，判据只有内存与可回收性，
 * 与用户点了什么无关。混在 `session.ts` 里读起来像是新建会话的一个步骤，
 * 而它其实是每次开会话都要交的一笔房租。
 */
/**
 * 同时活着的引擎会话上限。
 *
 * 4 是这么定的：一个 codex 会话实测 260 MB / 4 个进程，4 条约 1 GB——
 * 到此为止。取 4 而不是 2 是给对比视图留余地（分叉出来的两条要同时活着），
 * 再加上当前这条和一条刚用过的。
 */
const DEFAULT_MAX_LIVE = 4

/**
 * 腾地方：超过上限就把**最久没动的空闲会话**收掉。
 *
 * ## 为什么在 launch 时做，而不是挂个定时器
 *
 * 资源压力恰好在这一刻产生。定时器要多一个时钟依赖、多一条测不准的路径，
 * 而它能做的事这里都能做——**在需要腾地方的那一刻腾**，是最简单的正确做法。
 *
 * ## 三种绝不收
 *
 * - **正在跑的**：收掉等于中断用户的活
 * - **等着审批的**：那张卡片还挂在界面上，收掉之后它永远等不到答复
 * - **等着回答原生问题的**：问题卡同样还挂着，收掉会把用户正在填的答案作废
 * - **没有引擎句柄的**：那种收掉就**回不来了**（接回原来那家认句柄，见 `revive.ts`），
 *   而回不来的不叫「收起来」，叫「弄丢了」
 */
export async function evict(ctx: Ctx, keep: ThreadId): Promise<void> {
  const cap = ctx.deps.maxLive ?? DEFAULT_MAX_LIVE
  const idle = [...ctx.live.values()]
    .filter(
      (e) =>
        e.thread.id !== keep &&
        e.turn === undefined &&
        e.thread.status !== "waiting_approval" &&
        (e.thread.pendingQuestions?.length ?? 0) === 0 &&
        e.thread.engineHandle !== undefined,
    )
    // 最久没动的先走
    .sort((a, b) => a.thread.updatedAt - b.thread.updatedAt)
  while (ctx.live.size >= cap && idle.length > 0) {
    const victim = idle.shift()
    if (victim === undefined) break
    await detach(ctx, victim)
  }
}

/**
 * 把一个会话从引擎上摘下来，但**记录全留着**。
 *
 * 界面上它变成历史会话——和重启之后所有会话一个样子，下一句话发出去时自动接回来（`revive.ts`）。
 */
async function detach(ctx: Ctx, entry: Live): Promise<void> {
  entry.gate.settleAll()
  entry.lease.active = false
  await entry.session.dispose().catch(() => undefined)
  ctx.live.delete(entry.thread.id)
  const at = ctx.deps.now()
  emit(ctx, { type: "thread.updated", at, thread: { ...entry.thread, detached: true, status: resting(entry.thread.status), updatedAt: at } })
}

/**
 * 引擎自己报告背后的进程或实时流没了（`StartRequest.onExit`）。
 *
 * 这条会话再收不到任何回音：摘成历史会话，下一句话照 `revive.ts` 用句柄重新拉起——
 * 和重启之后、或被上限收起来的会话一个样子。还挂着的那一轮先按失败收口：
 * 驱动通常已经收过（那时这里什么都不做），没收的话轮次会永远停在 running。
 */
export async function exited(ctx: Ctx, entry: Live, detail: string): Promise<void> {
  if (!isCurrent(ctx, entry)) return
  const turnId = entry.turn
  if (turnId !== undefined) {
    emit(ctx, { type: "turn.completed", at: ctx.deps.now(), turnId, status: "failed", error: detail })
  }
  await detach(ctx, entry)
}
