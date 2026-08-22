import type { ThreadId } from "@omni/protocol"
import { discardUnstarted, emit, type Ctx } from "./ctx.js"

/** 后一条临时会话出现时，取消仍卡在 driver.start、尚未进入 live 表的前一条。 */
export async function dropPendingTemps(ctx: Ctx, keep: readonly ThreadId[]): Promise<void> {
  for (const threadId of [...ctx.uncommitted.keys()]) {
    if (keep.includes(threadId) || ctx.live.has(threadId)) continue
    ctx.removed.add(threadId)
    await discardUnstarted(ctx, threadId)
    emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId })
  }
}
