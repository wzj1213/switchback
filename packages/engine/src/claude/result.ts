import type { TurnStatus } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { clearTasks } from "./tasks.js"
import { resetPlan } from "./plan.js"
import { turnError, turnStatus } from "./translate.js"
import { applyResultDenials, clearDenials } from "./denials.js"
import { clearThinking } from "./thinking.js"
import { clearRetractions } from "./retraction.js"
import { resetStream } from "./stream.js"
import { addOutputTokens, claudeUsage, type ContextSnapshot } from "./usage.js"
import type { TurnRef } from "./loop.js"
import type { RawLoopMessage } from "./loop-wire.js"
import { localeOf } from "../locale.js"
import { CLAUDE_RESULT } from "./result.messages.js"

export interface ResultContext {
  req: StartRequest
  context: () => Promise<ContextSnapshot | undefined>
}

interface Phase {
  ref: TurnRef
  req: StartRequest
  turnId: string
  at: number
}

/** 中断或异常收尾时，把不会再有结果的工具从 running 落到原生终态。 */
function sweepTools({ ref, req, at }: Phase, status: TurnStatus): void {
  const ending = status === "interrupted" ? "interrupted" : "failed"
  for (const item of ref.tools.values()) {
    req.emit({
      type: "item.updated", at,
      item: status === "completed"
        ? { ...item, status: "failed", error: CLAUDE_RESULT[localeOf(req)].noToolResult }
        : { ...item, status: ending },
    })
  }
  ref.tools.clear()
}

/** 清一个原生阶段的瞬时状态；steer 后的下一段仍可沿用同一个 turn id。 */
function clearPhase(phase: Phase, status: TurnStatus): void {
  const { ref, req, turnId, at } = phase
  clearThinking(ref.thinking, { at, threadId: req.threadId, turnId, emit: req.emit })
  sweepTools(phase, status)
  ref.notices.clear()
  clearRetractions(ref.retractions)
  clearDenials(ref.denials)
  resetStream(ref.stream)
  ref.retry = undefined
  clearTasks(ref.tasks, at, req)
  resetPlan(ref.plan)
}

function clearTurnUsage(ref: TurnRef): void {
  ref.pendingSteers = 0
  ref.latestUsage = undefined
  ref.outputTokens = undefined
  ref.halt.turn = undefined
}

/** 消息流崩溃或退出但没给 result 时的幂等收口。 */
export function endTurn(ref: TurnRef, req: StartRequest, at: number, status: TurnStatus): void {
  const turnId = ref.current
  if (turnId === undefined) return
  ref.current = undefined
  clearPhase({ ref, req, turnId, at }, status)
  clearTurnUsage(ref)
  req.emit({ type: "turn.completed", at, turnId, status })
}

/** 有待兑现的 priority:now 时，这条 result 只是阶段边界，不是用户回合终点。 */
function finishIfSteered(phase: Phase): boolean {
  if (phase.ref.pendingSteers <= 0) return false
  phase.ref.pendingSteers -= 1
  clearPhase(phase, "interrupted")
  phase.ref.latestUsage = undefined
  return true
}

function emitUsage(msg: RawLoopMessage, phase: Phase, context: ContextSnapshot | undefined): void {
  const { ref, req, at } = phase
  const reported = msg.usage !== undefined || ref.latestUsage !== undefined || context !== undefined
  if (!reported) return
  req.emit({
    type: "usage.updated", at, threadId: req.threadId, engine: "claude",
    usage: claudeUsage(msg.usage ?? {}, {
      context, latest: ref.latestUsage, outputTokens: ref.outputTokens,
    }),
  })
}

function finishResult(msg: RawLoopMessage, phase: Phase): void {
  const { ref, req, turnId, at } = phase
  const status = turnStatus(msg.subtype ?? "", msg.is_error === true)
  ref.current = undefined
  clearPhase(phase, status)
  clearTurnUsage(ref)
  const error = status === "failed" ? turnError(msg) : undefined
  req.emit({ type: "turn.completed", at, turnId, status, ...(error === undefined ? {} : { error }) })
}

export async function onResult(
  msg: RawLoopMessage,
  ref: TurnRef,
  ctx: ResultContext,
  at: number,
): Promise<void> {
  const { req } = ctx
  if (msg.session_id !== undefined) req.onHandle?.(msg.session_id)
  const turnId = ref.current
  applyResultDenials(msg, ref.denials, ref.tools, { at, emit: req.emit })
  if (turnId === undefined) {
    clearDenials(ref.denials)
    return
  }
  const phase = { ref, req, turnId, at }
  ref.outputTokens = addOutputTokens(ref.outputTokens, msg.usage)
  if (finishIfSteered(phase)) return
  const context = await ctx.context()
  // 查询用量时也允许插入；送达了就把眼前这条 result 改判为阶段边界。
  if (finishIfSteered(phase)) return
  emitUsage(msg, phase, context)
  finishResult(msg, phase)
}
