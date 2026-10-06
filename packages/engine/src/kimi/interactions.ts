import { decide } from "@switchback/approval"
import type { QuestionAnswer, QuestionPrompt, QuestionResponse, Trust } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { sanitize } from "../claude/permission.js"
import { approvalRequest, approvalSummary } from "./approve.js"
import { KimiApiError, sessionPath, type KimiApi } from "./http.js"
import type { KimiApproval, KimiPayload, KimiQuestion } from "./wire.js"

export interface InteractionDeps {
  api: KimiApi
  sessionId: string
  req: StartRequest
  trust: () => Trust
  onError: (message: string) => void
}

const QUESTION_DISMISSED = 40909
const ALREADY_RESOLVED = 40902

function terminalError(error: unknown): boolean {
  return (
    error instanceof KimiApiError &&
    (error.code === QUESTION_DISMISSED || error.code === ALREADY_RESOLVED)
  )
}

function approvalOf(payload: KimiPayload): KimiApproval | undefined {
  if (
    typeof payload.approval_id !== "string" ||
    typeof payload.tool_call_id !== "string" ||
    typeof payload.tool_name !== "string" ||
    typeof payload.action !== "string"
  ) {
    return undefined
  }
  return {
    approval_id: payload.approval_id,
    session_id: payload.sessionId ?? "",
    turn_id: payload.turnId,
    tool_call_id: payload.tool_call_id,
    tool_name: payload.tool_name,
    action: payload.action,
    tool_input_display: payload.tool_input_display,
  }
}

function questionOf(payload: KimiPayload): KimiQuestion | undefined {
  if (typeof payload.question_id !== "string" || !Array.isArray(payload.questions)) return undefined
  return {
    question_id: payload.question_id,
    session_id: payload.sessionId ?? "",
    tool_call_id: payload.tool_call_id,
    questions: payload.questions,
  }
}

function asApproval(payload: KimiPayload | KimiApproval): KimiApproval | undefined {
  return "session_id" in payload && typeof payload.approval_id === "string"
    ? (payload as KimiApproval)
    : approvalOf(payload as KimiPayload)
}

function asQuestion(payload: KimiPayload | KimiQuestion): KimiQuestion | undefined {
  return "session_id" in payload && typeof payload.question_id === "string"
    ? (payload as KimiQuestion)
    : questionOf(payload as KimiPayload)
}

function promptOf(question: KimiQuestion["questions"][number]): QuestionPrompt {
  return {
    id: question.id,
    question: sanitize(question.question),
    options: question.options.map((option) => ({
      id: option.id,
      label: sanitize(option.label),
      ...(option.description === undefined ? {} : { description: sanitize(option.description) }),
    })),
    ...(question.header === undefined ? {} : { header: sanitize(question.header) }),
    ...(question.body === undefined ? {} : { body: sanitize(question.body) }),
    ...(question.multi_select === undefined ? {} : { multiSelect: question.multi_select }),
    ...(question.allow_other === undefined ? {} : { allowOther: question.allow_other }),
    ...(question.other_label === undefined ? {} : { otherLabel: sanitize(question.other_label) }),
    ...(question.other_description === undefined
      ? {}
      : { otherDescription: sanitize(question.other_description) }),
  }
}

function wireAnswer(answer: QuestionAnswer): unknown {
  if (answer.kind === "single") return { kind: answer.kind, option_id: answer.optionId }
  if (answer.kind === "multi") return { kind: answer.kind, option_ids: answer.optionIds }
  if (answer.kind === "other") return { kind: answer.kind, text: answer.text }
  if (answer.kind === "multi_with_other") {
    return { kind: answer.kind, option_ids: answer.optionIds, other_text: answer.otherText }
  }
  return answer
}

function wireResponse(response: Extract<QuestionResponse, { answers: unknown }>): unknown {
  return {
    answers: Object.fromEntries(
      Object.entries(response.answers).map(([questionId, answer]) => [
        questionId,
        wireAnswer(answer),
      ]),
    ),
    method: "click",
  }
}

export class KimiInteractions {
  private readonly handled = new Set<string>()
  private readonly pending = new Map<string, AbortController>()

  constructor(private readonly deps: InteractionDeps) {}

  approval(payload: KimiPayload | KimiApproval): void {
    const approval = asApproval(payload)
    if (approval === undefined || this.handled.has(approval.approval_id)) return
    this.handled.add(approval.approval_id)
    const controller = this.begin(approval.approval_id)
    void this.decide(approval, controller.signal)
      .catch((error) => this.catch(approval.approval_id, controller.signal, error))
      .finally(() => this.release(approval.approval_id, controller))
  }

  private failed(id: string, error: unknown): void {
    this.handled.delete(id)
    this.deps.onError(error instanceof Error ? error.message : String(error))
  }

  private async decide(approval: KimiApproval, signal: AbortSignal): Promise<void> {
    const req = approvalRequest(approval, this.deps.req.cwd)
    const verdict = decide(req, {
      trust: this.deps.trust(),
      worksite: this.deps.req.cwd,
      home: this.deps.req.home,
      memory: this.deps.req.memory(),
    })
    if (verdict.action === "allow") {
      await this.resolve(approval.approval_id, { allow: true, remember: "once" }, signal)
      return
    }
    if (verdict.action === "deny") {
      await this.resolve(
        approval.approval_id,
        { allow: false, remember: "once", feedback: verdict.reason },
        signal,
      )
      return
    }
    const answer = await this.deps.req.askUser(
      {
        toolCallId: approval.tool_call_id,
        tool: approval.tool_name,
        summary: approvalSummary(approval),
        reason: verdict.reason,
        ...(verdict.redline === undefined ? {} : { redline: verdict.redline }),
        ...(verdict.suggest === undefined
          ? {}
          : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
      },
      { signal },
    )
    if (signal.aborted) return
    await this.resolve(
      approval.approval_id,
      { ...answer, ...(answer.allow ? {} : { feedback: verdict.reason }) },
      signal,
    )
  }

  private resolve(
    id: string,
    answer: { allow: boolean; remember: string; feedback?: string },
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) return Promise.resolve()
    return this.deps.api.post(
      sessionPath(this.deps.sessionId, `/approvals/${encodeURIComponent(id)}`),
      {
        decision: answer.allow ? "approved" : "rejected",
        ...(answer.allow && answer.remember !== "once" ? { scope: "session" } : {}),
        ...(answer.feedback === undefined ? {} : { feedback: answer.feedback }),
      },
    )
  }

  question(payload: KimiPayload | KimiQuestion): void {
    const question = asQuestion(payload)
    if (question === undefined || this.handled.has(question.question_id)) return
    this.handled.add(question.question_id)
    const controller = this.begin(question.question_id)
    void this.answerQuestion(question, controller.signal)
      .catch((error) => this.catch(question.question_id, controller.signal, error))
      .finally(() => this.release(question.question_id, controller))
  }

  private async answerQuestion(question: KimiQuestion, signal: AbortSignal): Promise<void> {
    const response = await this.deps.req.askQuestion(question.questions.map(promptOf), { signal })
    if (signal.aborted) return
    const path = sessionPath(
      this.deps.sessionId,
      `/questions/${encodeURIComponent(question.question_id)}`,
    )
    if ("dismissed" in response) {
      await this.deps.api.post(`${path}:dismiss`)
      return
    }
    await this.deps.api.post(path, wireResponse(response))
  }

  private begin(id: string): AbortController {
    const controller = new AbortController()
    this.pending.set(id, controller)
    return controller
  }

  private release(id: string, controller: AbortController): void {
    if (this.pending.get(id) === controller) this.pending.delete(id)
  }

  private catch(id: string, signal: AbortSignal, error: unknown): void {
    if (!signal.aborted && !terminalError(error)) this.failed(id, error)
  }

  handle(payload: KimiPayload): boolean {
    const type = payload.type
    if (type === "event.approval.requested") {
      this.approval(payload)
      return true
    }
    if (type === "event.question.requested") {
      this.question(payload)
      return true
    }
    if (
      type !== "event.approval.resolved" &&
      type !== "event.approval.expired" &&
      type !== "event.question.answered" &&
      type !== "event.question.dismissed"
    )
      return false
    const id = type.startsWith("event.approval.") ? payload.approval_id : payload.question_id
    if (typeof id === "string") {
      this.handled.add(id)
      this.pending.get(id)?.abort()
    }
    return true
  }

  reconcile(approvals: readonly KimiApproval[], questions: readonly KimiQuestion[]): void {
    const current = new Set([
      ...approvals.map((approval) => approval.approval_id),
      ...questions.map((question) => question.question_id),
    ])
    for (const [id, controller] of this.pending) {
      if (!current.has(id)) controller.abort()
    }
    for (const approval of approvals) this.approval(approval)
    for (const question of questions) this.question(question)
  }

  dispose(): void {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }
}
