import type { TurnId } from "@omni/protocol"

interface TurnState {
  codexThread: string | undefined
  codexTurn: string | undefined
  turn: TurnId | undefined
  model: string | undefined
  effort: string | undefined
}

export interface StartTurnContext {
  state: TurnState
  call: (method: string, params: unknown) => Promise<unknown>
  fail: (message: string) => void
  discard?: (nativeTurn: string) => void
}

/** `turn/start` 失败也必须落宿主终态；否则输入框会永久停在 running。 */
export async function startTurn(
  ctx: StartTurnContext,
  text: string,
  turnId: TurnId,
  attachments?: readonly string[],
): Promise<void> {
  const { state } = ctx
  if (state.codexThread === undefined) throw new Error("codex 会话尚未就绪")
  state.turn = turnId
  state.codexTurn = undefined
  try {
    const started = await ctx.call("turn/start", {
      threadId: state.codexThread,
      input: inputItems(text, attachments),
      ...(state.model === undefined ? {} : { model: state.model }),
      ...(state.effort === undefined ? {} : { effort: state.effort }),
    })
    const native = (started as { turn?: { id?: string } } | undefined)?.turn?.id
    if (state.turn === turnId) state.codexTurn = native
    else if (native !== undefined) {
      // 收工通知可能跑在 RPC 回包前面。此时宿主已经释放这轮；若原生轮次其实还活着，
      // best-effort interrupt，避免一个没有宿主持有者的后台任务继续改文件。
      ctx.discard?.(native)
      await ctx.call("turn/interrupt", { threadId: state.codexThread, turnId: native }).catch(() => undefined)
    }
  } catch (error) {
    // 这发 RPC 迟到时，宿主可能已经靠完成通知开了下一轮；旧失败不能收掉新轮。
    if (state.turn === turnId) ctx.fail(error instanceof Error ? error.message : String(error))
    throw error
  }
}

/** 开一轮与中途改向必须发送同一种输入项形状。 */
export function inputItems(text: string, attachments?: readonly string[]): readonly unknown[] {
  return [
    { type: "text", text, text_elements: [] },
    ...(attachments ?? []).map((path) => ({ type: "localImage", path })),
  ]
}
