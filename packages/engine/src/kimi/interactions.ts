import { decide } from "@omni/approval"
import type { Trust } from "@omni/protocol"
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
  onQuestion: (message: string) => void
}

const QUESTION_DISMISSED = 40909

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

function questionSummary(question: KimiQuestion): string {
  return question.questions
    .map((entry) => {
      const options = entry.options.map((option) => option.label).join(" / ")
      const text = options === "" ? entry.question : `${entry.question}（${options}）`
      return sanitize(text)
    })
    .join("；")
}

export class KimiInteractions {
  private readonly handled = new Set<string>()

  constructor(private readonly deps: InteractionDeps) {}

  approval(payload: KimiPayload | KimiApproval): void {
    const approval = asApproval(payload)
    if (approval === undefined || this.handled.has(approval.approval_id)) return
    this.handled.add(approval.approval_id)
    void this.decide(approval).catch((error) => {
      this.failed(approval.approval_id, error)
    })
  }

  private failed(id: string, error: unknown): void {
    this.handled.delete(id)
    this.deps.onError(error instanceof Error ? error.message : String(error))
  }

  private async decide(approval: KimiApproval): Promise<void> {
    const req = approvalRequest(approval, this.deps.req.cwd)
    const verdict = decide(req, {
      trust: this.deps.trust(),
      worksite: this.deps.req.cwd,
      home: this.deps.req.home,
      memory: this.deps.req.memory(),
    })
    if (verdict.action === "allow") {
      await this.resolve(approval.approval_id, true, "once")
      return
    }
    if (verdict.action === "deny") {
      await this.resolve(approval.approval_id, false, "once", verdict.reason)
      return
    }
    const answer = await this.deps.req.askUser({
      toolCallId: approval.tool_call_id,
      tool: approval.tool_name,
      summary: approvalSummary(approval),
      reason: verdict.reason,
      ...(verdict.redline === undefined ? {} : { redline: verdict.redline }),
      ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
    })
    await this.resolve(approval.approval_id, answer.allow, answer.remember, answer.allow ? undefined : verdict.reason)
  }

  private resolve(id: string, allow: boolean, remember: string, feedback?: string): Promise<unknown> {
    return this.deps.api.post(sessionPath(this.deps.sessionId, `/approvals/${encodeURIComponent(id)}`), {
      decision: allow ? "approved" : "rejected",
      ...(allow && remember !== "once" ? { scope: "session" } : {}),
      ...(feedback === undefined ? {} : { feedback }),
    })
  }

  question(payload: KimiPayload | KimiQuestion): void {
    const question = asQuestion(payload)
    if (question === undefined || this.handled.has(question.question_id)) return
    this.handled.add(question.question_id)
    const summary = questionSummary(question)
    this.deps.onQuestion(summary)
    void this.deps.api
      .post(sessionPath(this.deps.sessionId, `/questions/${encodeURIComponent(question.question_id)}:dismiss`))
      .catch((error) => {
        if (!(error instanceof KimiApiError) || error.code !== QUESTION_DISMISSED) {
          this.failed(question.question_id, error)
        }
      })
  }
}
