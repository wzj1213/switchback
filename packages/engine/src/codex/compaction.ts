import type { TurnId } from "@switchback/protocol"

export interface CompactionContext {
  state: { codexThread: string | undefined; turn: TurnId | undefined }
  call: (method: string, params: unknown) => Promise<unknown>
  fail: (message: string) => void
}

/** RPC 只确认任务已经提交；真正的终态仍由 `turn/completed` 通知结算。 */
export async function startCompaction(ctx: CompactionContext, turnId: TurnId): Promise<void> {
  const { codexThread } = ctx.state
  if (codexThread === undefined) throw new Error("会话还没起来，没法压缩")
  if (ctx.state.turn !== undefined) throw new Error("Codex 还有一轮正在运行，没法压缩")
  ctx.state.turn = turnId
  try {
    await ctx.call("thread/compact/start", { threadId: codexThread })
  } catch (error) {
    ctx.fail(String(error))
    throw error
  }
}
