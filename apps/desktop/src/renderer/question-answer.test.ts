import type { QuestionPrompt } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { questionResponse, type QuestionDrafts } from "./question-answer.js"

const singleQuestion: QuestionPrompt = {
  id: "one",
  question: "单选",
  options: [{ id: "a", label: "A" }],
}

const questions: readonly QuestionPrompt[] = [
  singleQuestion,
  {
    id: "many",
    question: "多选",
    options: [{ id: "x", label: "X" }],
    multiSelect: true,
    allowOther: true,
  },
]

describe("问题卡组装回答", () => {
  const cases: readonly { name: string; drafts: QuestionDrafts; expected: unknown }[] = [
    {
      name: "单选与多选",
      drafts: {
        one: { optionIds: ["a"], other: false, otherText: "", noteText: "" },
        many: { optionIds: ["x"], other: false, otherText: "", noteText: "" },
      },
      expected: {
        answers: {
          one: { kind: "single", optionId: "a" },
          many: { kind: "multi", optionIds: ["x"] },
        },
      },
    },
    {
      name: "多选加自填",
      drafts: {
        one: { optionIds: [], other: true, otherText: "自己的答案", noteText: "" },
        many: { optionIds: ["x"], other: true, otherText: "再补一个", noteText: "" },
      },
      expected: {
        answers: {
          one: { kind: "other", text: "自己的答案" },
          many: { kind: "multi_with_other", optionIds: ["x"], otherText: "再补一个" },
        },
      },
    },
    {
      name: "漏选",
      drafts: {
        one: { optionIds: [], other: false, otherText: "", noteText: "" },
        many: { optionIds: ["x"], other: false, otherText: "", noteText: "" },
      },
      expected: undefined,
    },
    {
      name: "自填空白",
      drafts: {
        one: { optionIds: [], other: true, otherText: "  ", noteText: "" },
        many: { optionIds: ["x"], other: false, otherText: "", noteText: "" },
      },
      expected: undefined,
    },
  ]

  it("只在逐题完成后生成与协议一致的答案", () => {
    for (const entry of cases) {
      expect(questionResponse(questions, entry.drafts), entry.name).toEqual(entry.expected)
    }
  })

  it("重复题号不覆盖前一题", () => {
    expect(questionResponse([singleQuestion, singleQuestion], {
      one: { optionIds: ["a"], other: false, otherText: "", noteText: "" },
    })).toBeUndefined()
  })

  it("普通选项可附备注，纯自由题和可跳过题也有独立形状", () => {
    const prompts: QuestionPrompt[] = [
      { ...singleQuestion, allowNote: true },
      { id: "free", question: "自由答", options: [], allowNote: true },
      { id: "optional", question: "可留空", options: [], allowNote: true, optional: true },
    ]
    expect(questionResponse(prompts, {
      one: { optionIds: ["a"], other: false, otherText: "", noteText: "带上快照" },
      free: { optionIds: [], other: false, otherText: "", noteText: "自由原文" },
      optional: { optionIds: [], other: false, otherText: "", noteText: "" },
    })).toEqual({ answers: {
      one: { kind: "single", optionId: "a", note: "带上快照" },
      free: { kind: "note", text: "自由原文" },
      optional: { kind: "skipped" },
    } })
  })
})
