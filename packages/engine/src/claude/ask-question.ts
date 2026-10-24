import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import type { QuestionAnswer, QuestionOption, QuestionPrompt, QuestionResponse } from "@switchback/protocol"
import type { InteractionWait } from "../contract.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_ASK } from "./ask-question.messages.js"

/**
 * Claude 的 `AskUserQuestion`：模型明确交给人回答的一组结构化问题。
 *
 * 它走的是权限询问那扇门——CLI 里这个工具 `requiresUserInteraction`、`checkPermissions` 回 `ask`——
 * 答案按 SDK 公开字段 `updatedInput.answers` 交回：键是问题原文，值是选中的选项文字，
 * 多选用「, 」连起来（CLI 自己就按这个格式拆）；备注与选中项的预览放 `annotations`。
 *
 * 以前它被判定器当成 meta 工具直接放行、不带答案：用户根本看不到问题，
 * CLI 则照它自己的逻辑告诉模型「The user did not answer the questions.」。
 */
export const ASK_USER_QUESTION = "AskUserQuestion"

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

type Raw = Readonly<Record<string, unknown>>

const recordOf = (value: unknown): Raw | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Raw : undefined

const nonBlank = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

function sourceOptions(raw: unknown): SourceOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap((value) => {
    const item = recordOf(value)
    const label = nonBlank(item?.["label"])
    if (label === undefined || seen.has(label)) return []
    seen.add(label)
    const description = nonBlank(item?.["description"])
    const preview = nonBlank(item?.["preview"])
    return [{ label, ...(description === undefined ? {} : { description }), ...(preview === undefined ? {} : { preview }) }]
  })
}

function parsedQuestion(raw: unknown, toolUseId: string, index: number, m: (typeof CLAUDE_ASK)[Locale]): ParsedQuestion | undefined {
  const item = recordOf(raw)
  const question = nonBlank(item?.["question"])
  if (question === undefined) return undefined
  const source = sourceOptions(item?.["options"])
  const options: QuestionOption[] = source.map(({ label, description, preview }) => ({
    id: label, label,
    ...(description === undefined ? {} : { description }),
    ...(preview === undefined ? {} : { preview }),
  }))
  const header = nonBlank(item?.["header"])
  return {
    source: question,
    options: new Map(source.map((option) => [option.label, option])),
    prompt: {
      id: `${toolUseId}:q${String(index)}`,
      question,
      ...(header === undefined ? {} : { header }),
      options,
      multiSelect: item?.["multiSelect"] === true,
      // 工具说明原话：「There should be no 'Other' option, that will be provided automatically」
      allowOther: true,
      otherLabel: m.other,
      otherDescription: m.writeAnswer,
      ...(options.length === 0 ? {} : {
        allowNote: true, noteLabel: m.note, noteDescription: m.addContext,
      }),
      optional: true,
    },
  }
}

export function parsedQuestions(input: Raw, toolUseId: string, locale: Locale = DEFAULT_LOCALE): ParsedQuestion[] {
  const raw = input["questions"]
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value, index) => {
    const parsed = parsedQuestion(value, toolUseId, index, CLAUDE_ASK[locale])
    return parsed === undefined ? [] : [parsed]
  })
}

interface Encoded {
  answer: string
  notes?: string
  preview?: string
}

function encoded(answer: QuestionAnswer, question: ParsedQuestion): Encoded | undefined {
  switch (answer.kind) {
    case "skipped":
      return undefined
    case "single": {
      const preview = question.options.get(answer.optionId)?.preview
      return {
        answer: answer.optionId,
        ...(answer.note === undefined ? {} : { notes: answer.note }),
        ...(preview === undefined ? {} : { preview }),
      }
    }
    case "multi":
      return { answer: answer.optionIds.join(", "), ...(answer.note === undefined ? {} : { notes: answer.note }) }
    case "multi_with_other":
      return { answer: [...answer.optionIds, answer.otherText].join(", ") }
    case "note":
    case "other":
      return { answer: answer.text }
  }
}

/** 一组回答 → CLI 认的 `updatedInput`。整组跳过就是空答案，CLI 会如实告诉模型「没有回答」。 */
export function answeredInput(input: Raw, questions: readonly ParsedQuestion[], response: QuestionResponse): Raw {
  const answers: Record<string, string> = {}
  const annotations: Record<string, { preview?: string; notes?: string }> = {}
  if (!("dismissed" in response)) {
    for (const question of questions) {
      const answer = response.answers[question.prompt.id]
      const one = answer === undefined ? undefined : encoded(answer, question)
      if (one === undefined) continue
      answers[question.source] = one.answer
      if (one.notes !== undefined || one.preview !== undefined) {
        annotations[question.source] = {
          ...(one.preview === undefined ? {} : { preview: one.preview }),
          ...(one.notes === undefined ? {} : { notes: one.notes }),
        }
      }
    }
  }
  return { ...input, answers, ...(Object.keys(annotations).length === 0 ? {} : { annotations }) }
}

/** 把问题交给宿主的问题卡，等人答完再放行这次工具调用。解析不出任何一题时照旧放行，由 CLI 自己报。 */
export async function askQuestions(
  input: Raw,
  toolUseId: string,
  ask: (questions: readonly QuestionPrompt[], wait?: InteractionWait) => Promise<QuestionResponse>,
  { signal, locale }: { signal?: AbortSignal | undefined; locale?: Locale } = {},
): Promise<PermissionResult> {
  const questions = parsedQuestions(input, toolUseId, locale)
  if (questions.length === 0) return { behavior: "allow" }
  const response = await ask(questions.map((question) => question.prompt), signal === undefined ? undefined : { signal })
  return { behavior: "allow", updatedInput: { ...answeredInput(input, questions, response) } }
}
