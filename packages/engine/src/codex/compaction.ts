import type { TurnId } from "@switchback/protocol"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CODEX_COMPACTION } from "./compaction.messages.js"

export interface CompactionContext {
  state: { codexThread: string | undefined; turn: TurnId | undefined }
  call: (method: string, params: unknown) => Promise<unknown>
  fail: (message: string) => void
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

/** RPC 只确认任务已经提交；真正的终态仍由 `turn/completed` 通知结算。 */
export async function startCompaction(ctx: CompactionContext, turnId: TurnId): Promise<void> {
  const { codexThread } = ctx.state
  if (codexThread === undefined) throw new Error(CODEX_COMPACTION[localeOf(ctx)].notReady)
  if (ctx.state.turn !== undefined) throw new Error(CODEX_COMPACTION[localeOf(ctx)].busy)
  ctx.state.turn = turnId
  try {
    await ctx.call("thread/compact/start", { threadId: codexThread })
  } catch (error) {
    ctx.fail(String(error))
    throw error
  }
}
