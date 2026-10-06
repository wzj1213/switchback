import type { QuestionAnswer, QuestionPrompt, QuestionResponse } from "@switchback/protocol"

export interface QuestionDraft {
  optionIds: readonly string[]
  other: boolean
  otherText: string
  noteText: string
}

export type QuestionDrafts = Readonly<Record<string, QuestionDraft>>

const EMPTY: QuestionDraft = { optionIds: [], other: false, otherText: "", noteText: "" }

export function draftOf(drafts: QuestionDrafts, id: string): QuestionDraft {
  return drafts[id] ?? EMPTY
}

export function freshDrafts(questions: readonly QuestionPrompt[]): QuestionDrafts {
  return Object.fromEntries(questions.map((question) => [question.id, { ...EMPTY }]))
}

function noteOf(question: QuestionPrompt, draft: QuestionDraft): string | undefined {
  return question.allowNote === true && draft.noteText.trim() !== "" ? draft.noteText : undefined
}

function singleAnswer(question: QuestionPrompt, draft: QuestionDraft): QuestionAnswer | undefined {
  if (draft.other) {
    return draft.otherText.trim() === "" ? undefined : { kind: "other", text: draft.otherText }
  }
  const note = noteOf(question, draft)
  if (draft.optionIds.length === 1) {
    return { kind: "single", optionId: draft.optionIds[0] ?? "", ...(note === undefined ? {} : { note }) }
  }
  if (note !== undefined) return { kind: "note", text: note }
  return question.optional === true ? { kind: "skipped" } : undefined
}

function multipleAnswer(question: QuestionPrompt, draft: QuestionDraft): QuestionAnswer | undefined {
  if (draft.other && draft.otherText.trim() === "") return undefined
  if (draft.other && draft.optionIds.length > 0) {
    return { kind: "multi_with_other", optionIds: draft.optionIds, otherText: draft.otherText }
  }
  if (draft.other) return { kind: "other", text: draft.otherText }
  const note = noteOf(question, draft)
  if (draft.optionIds.length > 0) {
    return { kind: "multi", optionIds: draft.optionIds, ...(note === undefined ? {} : { note }) }
  }
  if (note !== undefined) return { kind: "note", text: note }
  return question.optional === true ? { kind: "skipped" } : undefined
}

export function questionResponse(
  questions: readonly QuestionPrompt[],
  drafts: QuestionDrafts,
): QuestionResponse | undefined {
  const answers: Record<string, QuestionAnswer> = {}
  for (const question of questions) {
    if (Object.hasOwn(answers, question.id)) return undefined
    const draft = draftOf(drafts, question.id)
    const answer = question.multiSelect === true
      ? multipleAnswer(question, draft)
      : singleAnswer(question, draft)
    if (answer === undefined) return undefined
    answers[question.id] = answer
  }
  return questions.length === 0 ? undefined : { answers }
}
