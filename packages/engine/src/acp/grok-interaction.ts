import type { QuestionAnswer, QuestionOption, QuestionPrompt, QuestionResponse } from "@switchback/protocol"
import type { ForeignInteraction } from "./caps.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { GROK_INTERACTION } from "./grok-interaction.messages.js"

type Text = (typeof GROK_INTERACTION)[Locale]
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

function parsedQuestion(raw: unknown, toolCallId: string, index: number, m: Text): ParsedQuestion | undefined {
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
      otherLabel: m.other,
      otherDescription: m.writeAnswer,
      ...(options.length === 0 ? {} : { allowNote: true, noteLabel: m.note, noteDescription: m.addContext }),
      optional: true,
    },
  }
}

function parsedQuestions(raw: unknown, toolCallId: string, m: Text): ParsedQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value, index) => {
    const parsed = parsedQuestion(value, toolCallId, index, m)
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
export function grokInteraction(method: string, params: unknown, locale: Locale = DEFAULT_LOCALE): ForeignInteraction | undefined {
  const payload = grokExtPayload(method, params, ASK)
  if (payload !== undefined) return askInteraction(payload, GROK_INTERACTION[locale])
  const plan = grokExtPayload(method, params, EXIT_PLAN)
  return plan === undefined ? undefined : planInteraction(plan, GROK_INTERACTION[locale])
}

function askInteraction(payload: Record<string, unknown>, m: Text): ForeignInteraction | undefined {
  const sessionId = nonBlank(payload?.["sessionId"])
  const toolCallId = nonBlank(payload?.["toolCallId"])
  if (sessionId === undefined || toolCallId === undefined) return undefined
  const questions = parsedQuestions(payload?.["questions"], toolCallId, m)
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

function planInteraction(payload: Record<string, unknown>, m: Text): ForeignInteraction | undefined {
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
      header: m.planHeader,
      question: m.planQuestion,
      body: plan ?? m.noPlan,
      options: [
        { id: "approved", label: m.approve, description: m.approveHint },
        { id: "cancelled", label: m.revise, description: m.reviseHint },
        { id: "abandoned", label: m.abandon, description: m.abandonHint },
      ],
      allowNote: true,
      noteLabel: m.planNote,
      noteDescription: m.planNoteHint,
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
