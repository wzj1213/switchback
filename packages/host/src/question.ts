import type {
  Command,
  PendingQuestion,
  QuestionAnswer,
  QuestionPrompt,
  QuestionResponse,
  Thread,
  ThreadId,
} from "@switchback/protocol"
import type { InteractionWait } from "@switchback/engine"
import { emit, isCurrent, type Ctx, type Live } from "./ctx.js"

const DISMISSED: QuestionResponse = { dismissed: true }

function selectedOptionsFit(question: QuestionPrompt, ids: readonly string[]): boolean {
  const optionIds = new Set(question.options.map((option) => option.id))
  return new Set(ids).size === ids.length && ids.every((id) => optionIds.has(id))
}

function multipleAnswerFits(
  question: QuestionPrompt,
  answer: Extract<QuestionAnswer, { kind: "multi" | "multi_with_other" }>,
): boolean {
  if (question.multiSelect !== true || !selectedOptionsFit(question, answer.optionIds)) return false
  if (answer.kind === "multi") {
    return answer.optionIds.length > 0 && noteFits(question, answer.note)
  }
  return question.allowOther === true && answer.otherText.trim() !== ""
}

function noteFits(question: QuestionPrompt, note: string | undefined): boolean {
  return note === undefined || (question.allowNote === true && note.trim() !== "")
}

function answerFits(question: QuestionPrompt, answer: QuestionAnswer): boolean {
  if (answer.kind === "skipped") return true
  if (answer.kind === "single") {
    return question.multiSelect !== true &&
      selectedOptionsFit(question, [answer.optionId]) &&
      noteFits(question, answer.note)
  }
  if (answer.kind === "note") return question.allowNote === true && answer.text.trim() !== ""
  if (answer.kind === "other") return question.allowOther === true && answer.text.trim() !== ""
  return multipleAnswerFits(question, answer)
}

/** 线上答案必须与当前那一组逐题对得上；旧卡、伪选项和漏题都不能送进引擎。 */
export function validQuestionResponse(
  pending: PendingQuestion,
  response: QuestionResponse,
): boolean {
  if ("dismissed" in response) return response.dismissed === true
  const expected = new Map(pending.questions.map((question) => [question.id, question]))
  const answers = Object.entries(response.answers)
  if (expected.size !== pending.questions.length || answers.length !== expected.size) return false
  return answers.every(([id, answer]) => {
    const question = expected.get(id)
    return question !== undefined && answerFits(question, answer)
  })
}

function withoutQuestion(thread: Thread, questionId: string, at: number): Thread {
  const pending = (thread.pendingQuestions ?? []).filter((question) => question.id !== questionId)
  const next = { ...thread, updatedAt: at }
  delete next.pendingQuestions
  return pending.length === 0 ? next : { ...next, pendingQuestions: pending }
}

function clearQuestion(ctx: Ctx, entry: Live, questionId: string): void {
  if (!(entry.thread.pendingQuestions ?? []).some((question) => question.id === questionId)) return
  const at = ctx.deps.now()
  entry.thread = withoutQuestion(entry.thread, questionId, at)
  if (isCurrent(ctx, entry)) emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** 引擎挂起一组原生问题；它可以与别的后台问题并存，不拿普通 prompt 冒充回答。 */
export function askQuestion(
  ctx: Ctx,
  threadId: ThreadId,
  questions: readonly QuestionPrompt[],
  wait?: InteractionWait,
): Promise<QuestionResponse> {
  const entry = ctx.live.get(threadId)
  if (entry === undefined || questions.length === 0 || wait?.signal?.aborted === true) {
    return Promise.resolve(DISMISSED)
  }
  const at = ctx.deps.now()
  const timeoutMs = validTimeout(wait?.timeoutMs)
  const pending: PendingQuestion = {
    id: ctx.deps.newId("qu"),
    questions,
    ...(timeoutMs === undefined ? {} : { expiresAt: at + timeoutMs }),
  }
  const answer = entry.gate.openQuestion(pending.id, () => clearQuestion(ctx, entry, pending.id))
  entry.thread = {
    ...entry.thread,
    pendingQuestions: [...(entry.thread.pendingQuestions ?? []), pending],
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  return settleQuestionWait({ entry, id: pending.id, answer, wait, timeoutMs })
}

function validTimeout(timeoutMs: number | undefined): number | undefined {
  return timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined
}

interface PendingWait {
  entry: Live
  id: string
  answer: Promise<QuestionResponse>
  wait: InteractionWait | undefined
  timeoutMs: number | undefined
}

function settleQuestionWait(pending: PendingWait): Promise<QuestionResponse> {
  const { entry, id, answer, wait, timeoutMs } = pending
  const cancel = (): void => {
    entry.gate.cancelQuestion(id)
  }
  const timer = timeoutMs === undefined ? undefined : setTimeout(cancel, timeoutMs)
  if (wait?.signal?.aborted === true) cancel()
  else wait?.signal?.addEventListener("abort", cancel, { once: true })
  return answer.finally(() => {
    if (timer !== undefined) clearTimeout(timer)
    wait?.signal?.removeEventListener("abort", cancel)
  })
}

/** 命中当前挂起项才落定；形状不符明确失败，让桌面/远程端都看得见。 */
export function resolveQuestion(
  ctx: Ctx,
  command: Extract<Command, { type: "question.resolve" }>,
): void {
  const entry = ctx.live.get(command.threadId)
  const pending = entry?.thread.pendingQuestions?.find((question) => question.id === command.questionId)
  if (entry === undefined || pending === undefined) return
  if (!validQuestionResponse(pending, command.response)) throw new Error("回答与当前问题不匹配，请重新选择")
  entry.gate.resolveQuestion(command.questionId, command.response)
}
