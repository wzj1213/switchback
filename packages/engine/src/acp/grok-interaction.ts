import type { QuestionAnswer, QuestionOption, QuestionPrompt, QuestionResponse } from "@omni/protocol"
import type { ForeignInteraction } from "./caps.js"
import { grokExtPayload, recordOf } from "./grok-ext.js"

const ASK = "x.ai/ask_user_question"
const EXIT_PLAN = "x.ai/exit_plan_mode"
const SESSION_NOTE = "x.ai/session_notification"
const OTHER = "Other"

interface SourceOption {
  label: string
  description?: string
  preview?: string
}

interface ParsedQuestion {
  source: string
  prompt: QuestionPrompt
  options: ReadonlyMap<string, SourceOption>
}

const nonBlank = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

function sourceOptions(raw: unknown): SourceOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const options: SourceOption[] = []
  for (const value of raw) {
    const item = recordOf(value)
    const label = nonBlank(item?.["label"])
    if (label === undefined || seen.has(label)) continue
    seen.add(label)
    const description = nonBlank(item?.["description"])
    const preview = nonBlank(item?.["preview"])
    options.push({ label, ...(description === undefined ? {} : { description }), ...(preview === undefined ? {} : { preview }) })
  }
  return options
}

function parsedQuestion(raw: unknown, toolCallId: string, index: number): ParsedQuestion | undefined {
  const item = recordOf(raw)
  const question = nonBlank(item?.["question"])
  if (question === undefined) return undefined
  const source = sourceOptions(item?.["options"])
  const options: QuestionOption[] = source.map(({ label, description, preview }) => ({
    id: label, label,
    ...(description === undefined ? {} : { description }),
    ...(preview === undefined ? {} : { preview }),
  }))
  return {
    source: question,
    options: new Map(source.map((option) => [option.label, option])),
    prompt: {
      id: `${toolCallId}:q${String(index)}`,
      question,
      options,
      multiSelect: item?.["multiSelect"] === true || item?.["multi_select"] === true,
      allowOther: true,
      otherLabel: "其他",
      otherDescription: "写下你的答案",
      ...(options.length === 0 ? {} : {
        allowNote: true, noteLabel: "补充说明（可选）", noteDescription: "可选：补充上下文",
      }),
      optional: true,
    },
  }
}

function parsedQuestions(raw: unknown, toolCallId: string): ParsedQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value, index) => {
    const parsed = parsedQuestion(value, toolCallId, index)
    return parsed === undefined ? [] : [parsed]
  })
}

interface EncodedAnswer {
  labels: string[]
  notes?: string
  preview?: string
}

function encodedAnswer(answer: QuestionAnswer, question: ParsedQuestion): EncodedAnswer | undefined {
  if (answer.kind === "skipped") return undefined
  if (answer.kind === "single") {
    const source = question.options.get(answer.optionId)
    return {
      labels: [answer.optionId],
      ...(answer.note === undefined ? {} : { notes: answer.note }),
      ...(source?.preview === undefined ? {} : { preview: source.preview }),
    }
  }
  if (answer.kind === "multi") {
    return { labels: [...answer.optionIds], ...(answer.note === undefined ? {} : { notes: answer.note }) }
  }
  if (answer.kind === "multi_with_other") {
    return { labels: [...answer.optionIds, OTHER], notes: answer.otherText }
  }
  return { labels: [OTHER], notes: answer.text }
}

function accepted(response: QuestionResponse, questions: readonly ParsedQuestion[]): unknown {
  if ("dismissed" in response) return { outcome: "cancelled" }
  const answers: Record<string, string[]> = {}
  const annotations: Record<string, { preview?: string; notes?: string }> = {}
  for (const question of questions) {
    const answer = response.answers[question.prompt.id]
    if (answer === undefined) continue
    const encoded = encodedAnswer(answer, question)
    if (encoded === undefined) continue
    answers[question.source] = encoded.labels
    if (encoded.preview !== undefined || encoded.notes !== undefined) {
      annotations[question.source] = {
        ...(encoded.preview === undefined ? {} : { preview: encoded.preview }),
        ...(encoded.notes === undefined ? {} : { notes: encoded.notes }),
      }
    }
  }
  return {
    outcome: "accepted",
    answers,
    ...(Object.keys(annotations).length === 0 ? {} : { annotations }),
  }
}

/** Grok 明确公开给 ACP client 的阻塞式结构化问题。 */
export function grokInteraction(method: string, params: unknown): ForeignInteraction | undefined {
  const payload = grokExtPayload(method, params, ASK)
  if (payload !== undefined) return askInteraction(payload)
  const plan = grokExtPayload(method, params, EXIT_PLAN)
  return plan === undefined ? undefined : planInteraction(plan)
}

function askInteraction(payload: Record<string, unknown>): ForeignInteraction | undefined {
  const sessionId = nonBlank(payload?.["sessionId"])
  const toolCallId = nonBlank(payload?.["toolCallId"])
  if (sessionId === undefined || toolCallId === undefined) return undefined
  const questions = parsedQuestions(payload?.["questions"], toolCallId)
  return {
    sessionId,
    key: toolCallId,
    questions: questions.map((question) => question.prompt),
    reply: (response) => accepted(response, questions),
  }
}

function planReply(response: QuestionResponse, id: string): unknown {
  if ("dismissed" in response) return { outcome: "cancelled" }
  const answer = response.answers[id]
  if (answer?.kind !== "single") return { outcome: "cancelled" }
  if (answer.optionId === "approved") return { outcome: "approved" }
  if (answer.optionId === "abandoned") return { outcome: "abandoned" }
  const feedback = answer.note?.trim()
  return { outcome: "cancelled", ...(feedback === undefined || feedback === "" ? {} : { feedback: answer.note }) }
}

function planInteraction(payload: Record<string, unknown>): ForeignInteraction | undefined {
  const sessionId = nonBlank(payload["sessionId"])
  const toolCallId = nonBlank(payload["toolCallId"])
  if (sessionId === undefined || toolCallId === undefined) return undefined
  const id = `${toolCallId}:plan`
  const plan = nonBlank(payload["planContent"])
  return {
    sessionId,
    key: toolCallId,
    questions: [{
      id,
      header: "Grok 计划审批",
      question: "如何处理这份计划？",
      body: plan ?? "Grok 未提供计划正文。",
      options: [
        { id: "approved", label: "批准并执行", description: "退出计划模式并开始执行" },
        { id: "cancelled", label: "要求修改", description: "把补充说明反馈给 Grok，继续规划" },
        { id: "abandoned", label: "放弃计划", description: "退出计划模式但不执行" },
      ],
      allowNote: true,
      noteLabel: "修改意见（可选）",
      noteDescription: "选择“要求修改”时，可在这里说明要改什么",
    }],
    reply: (response) => planReply(response, id),
  }
}

/** 多个原生客户端 first-answer-wins；别处先答后撤掉本地问题卡。 */
export function grokInteractionResolved(method: string, params: unknown): string | undefined {
  const payload = grokExtPayload(method, params, SESSION_NOTE)
  const update = recordOf(payload?.["update"])
  if (update?.["sessionUpdate"] !== "interaction_resolved") return undefined
  return nonBlank(update["tool_call_id"]) ?? nonBlank(update["toolCallId"])
}
