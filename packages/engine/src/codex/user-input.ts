import type { QuestionAnswer, QuestionOption, QuestionPrompt, QuestionResponse } from "@omni/protocol"
import { sanitize } from "../claude/permission.js"
import type { StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"

export const USER_INPUT_REQUEST = "item/tool/requestUserInput"
/** 0.149.0 原生 TUI：60 秒静默窗 + 60 秒可见倒计时。 */
export const NON_BLOCKING_TIMEOUT_MS = 120_000

interface WireOption {
  label?: unknown
  description?: unknown
}

export interface WireUserInputQuestion {
  id?: unknown
  header?: unknown
  question?: unknown
  isOther?: unknown
  isSecret?: unknown
  options?: unknown
}

export interface WireUserInputRequest {
  itemId?: unknown
  questions?: unknown
  isBlocking?: unknown
  autoResolutionMs?: unknown
}

export interface UserInputDeps {
  askQuestion: StartRequest["askQuestion"]
  signal?: AbortSignal
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

function optionsOf(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const options: QuestionOption[] = []
  for (const candidate of raw) {
    const option = record(candidate) as WireOption | undefined
    if (typeof option?.label !== "string" || option.label === "" || seen.has(option.label)) continue
    seen.add(option.label)
    options.push({
      // Codex 没有独立 option id，应答要求的就是原始 label。
      id: option.label,
      label: sanitize(option.label),
      ...(typeof option.description === "string" && option.description !== ""
        ? { description: sanitize(option.description) }
        : {}),
    })
  }
  return options
}

function hasQuestionText(question: WireUserInputQuestion | undefined): question is WireUserInputQuestion & {
  id: string
  question: string
} {
  return typeof question?.id === "string" && question.id !== "" &&
    typeof question.question === "string" && question.question !== ""
}

function promptOf(raw: unknown): QuestionPrompt | undefined {
  const question = record(raw) as WireUserInputQuestion | undefined
  if (!hasQuestionText(question)) return undefined
  const options = optionsOf(question.options)
  const freeform = options.length === 0
  return {
    id: question.id,
    question: sanitize(question.question),
    options,
    allowNote: true,
    noteLabel: freeform ? "回答" : "补充说明（可选）",
    noteDescription: freeform ? "输入回答" : "可选：补充上下文",
    optional: true,
    ...(typeof question.header === "string" && question.header !== ""
      ? { header: sanitize(question.header) }
      : {}),
    ...(question.isOther === true && !freeform
      ? { allowOther: true, otherLabel: "以上都不是", otherDescription: "写下你的答案" }
      : {}),
    ...(question.isSecret === true ? { secret: true } : {}),
  }
}

export function userInputPrompts(params: WireUserInputRequest): QuestionPrompt[] {
  if (!Array.isArray(params.questions)) return []
  const seen = new Set<string>()
  const prompts: QuestionPrompt[] = []
  for (const raw of params.questions) {
    const prompt = promptOf(raw)
    if (prompt === undefined || seen.has(prompt.id)) continue
    seen.add(prompt.id)
    prompts.push(prompt)
  }
  return prompts
}

const note = (text: string): string => `user_note: ${text}`
const OTHER_OPTION = "None of the above"

function answerValues(answer: QuestionAnswer): string[] {
  if (answer.kind === "single") {
    return [answer.optionId, ...(answer.note === undefined ? [] : [note(answer.note)])]
  }
  if (answer.kind === "multi") {
    return [...answer.optionIds, ...(answer.note === undefined ? [] : [note(answer.note)])]
  }
  if (answer.kind === "multi_with_other") {
    return [...answer.optionIds, OTHER_OPTION, note(answer.otherText)]
  }
  if (answer.kind === "note") return [note(answer.text)]
  if (answer.kind === "other") return [OTHER_OPTION, note(answer.text)]
  return []
}

export function userInputResponse(response: QuestionResponse): unknown {
  if ("dismissed" in response) return { answers: {} }
  return {
    answers: Object.fromEntries(
      Object.entries(response.answers).map(([id, answer]) => [id, { answers: answerValues(answer) }]),
    ),
  }
}

/** 结构化问题只走原生 RPC 回包，不转成一条新的模型提示。 */
export async function answerUserInput(call: ServerCall, deps: UserInputDeps): Promise<void> {
  const params = call.params as WireUserInputRequest
  const prompts = userInputPrompts(params)
  if (prompts.length === 0) {
    call.respond({ answers: {} })
    return
  }
  const timeoutMs = params.isBlocking === false ? NON_BLOCKING_TIMEOUT_MS : undefined
  const response = await deps.askQuestion(prompts, {
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  if (deps.signal?.aborted !== true) call.respond(userInputResponse(response))
}
