import { describe, expect, it } from "vitest"
import type { QuestionPrompt } from "@switchback/protocol"
import { freshDrafts, questionResponse } from "./question-answer.js"

const questions: readonly QuestionPrompt[] = [
  {
    id: "target",
    question: "Which target?",
    options: [{ id: "Core", label: "Core" }],
    allowNote: true,
    optional: true,
  },
  { id: "details", question: "Anything else?", options: [], allowNote: true, optional: true },
]

describe("远程端结构化回答", () => {
  it("保留选项备注、自由回答，也允许逐题留空", () => {
    const drafts = freshDrafts(questions)
    expect(questionResponse(questions, {
      ...drafts,
      target: { optionIds: ["Core"], other: false, otherText: "", noteText: "include snapshots" },
      details: { optionIds: [], other: false, otherText: "", noteText: "SDK wrapper" },
    })).toEqual({ answers: {
      target: { kind: "single", optionId: "Core", note: "include snapshots" },
      details: { kind: "note", text: "SDK wrapper" },
    } })
    expect(questionResponse(questions, drafts)).toEqual({ answers: {
      target: { kind: "skipped" },
      details: { kind: "skipped" },
    } })
  })
})
