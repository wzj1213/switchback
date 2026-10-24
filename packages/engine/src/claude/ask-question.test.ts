import { describe, expect, it } from "vitest"
import type { QuestionPrompt, QuestionResponse } from "@switchback/protocol"
import { answeredInput, askQuestions, parsedQuestions } from "./ask-question.js"

const input = {
  questions: [
    {
      question: "用哪个日期库？",
      header: "库",
      multiSelect: false,
      options: [
        { label: "dayjs", description: "小", preview: "import dayjs from 'dayjs'" },
        { label: "date-fns", description: "函数式" },
      ],
    },
    {
      question: "要开哪些检查？",
      header: "检查",
      multiSelect: true,
      options: [{ label: "lint", description: "" }, { label: "test", description: "" }, { label: "lint", description: "重复" }],
    },
  ],
}

describe("Claude AskUserQuestion → 问题卡", () => {
  it("选项文字当 id，重复的选项只留一个；每题都能填「其他」、可跳过", () => {
    const [first, second] = parsedQuestions(input, "toolu_1").map((one) => one.prompt)
    expect(first).toMatchObject({
      id: "toolu_1:q0", question: "用哪个日期库？", header: "库", multiSelect: false, allowOther: true, optional: true,
      options: [{ id: "dayjs", label: "dayjs", description: "小", preview: "import dayjs from 'dayjs'" }, { id: "date-fns" }],
    })
    expect(second?.options.map((option) => option.id)).toEqual(["lint", "test"])
    expect(second?.multiSelect).toBe(true)
  })

  it("问题原文缺失的题不出卡", () => {
    expect(parsedQuestions({ questions: [{ question: " ", options: [] }, "x"] }, "t")).toEqual([])
    expect(parsedQuestions({}, "t")).toEqual([])
  })
})

describe("问题卡的回答 → CLI 认的 updatedInput", () => {
  const questions = parsedQuestions(input, "toolu_1")
  const cases: readonly { name: string; response: QuestionResponse; answers: unknown; annotations?: unknown }[] = [
    {
      name: "单选带备注：答案是选项文字，选中项的预览和备注进 annotations",
      response: { answers: { "toolu_1:q0": { kind: "single", optionId: "dayjs", note: "体积优先" } } },
      answers: { "用哪个日期库？": "dayjs" },
      annotations: { "用哪个日期库？": { preview: "import dayjs from 'dayjs'", notes: "体积优先" } },
    },
    {
      name: "多选用「, 」连起来——CLI 自己就按这个拆",
      response: { answers: { "toolu_1:q1": { kind: "multi", optionIds: ["lint", "test"] } } },
      answers: { "要开哪些检查？": "lint, test" },
    },
    {
      name: "其他：原话就是答案",
      response: { answers: { "toolu_1:q0": { kind: "other", text: "用 Temporal" } } },
      answers: { "用哪个日期库？": "用 Temporal" },
    },
    {
      name: "多选加其他：选项和原话一起连上",
      response: { answers: { "toolu_1:q1": { kind: "multi_with_other", optionIds: ["lint"], otherText: "typecheck" } } },
      answers: { "要开哪些检查？": "lint, typecheck" },
    },
    {
      name: "跳过的题不写答案",
      response: { answers: { "toolu_1:q0": { kind: "skipped" }, "toolu_1:q1": { kind: "multi", optionIds: ["test"] } } },
      answers: { "要开哪些检查？": "test" },
    },
    { name: "整组跳过就是空答案，CLI 会如实告诉模型没有回答", response: { dismissed: true }, answers: {} },
  ]
  for (const one of cases) {
    it(one.name, () => {
      const out = answeredInput(input, questions, one.response)
      expect(out["questions"]).toBe(input.questions)
      expect(out["answers"]).toEqual(one.answers)
      expect(out["annotations"]).toEqual(one.annotations)
    })
  }

  it("问题卡收到 CLI 的撤回信号，答完才放行这次调用", async () => {
    const controller = new AbortController()
    const seen: { prompts: readonly QuestionPrompt[]; signal?: AbortSignal }[] = []
    const result = await askQuestions(input, "toolu_1", (prompts, wait) => {
      seen.push({ prompts, ...(wait?.signal === undefined ? {} : { signal: wait.signal }) })
      return Promise.resolve({ answers: { "toolu_1:q0": { kind: "single", optionId: "date-fns" } } })
    }, { signal: controller.signal })
    expect(seen[0]?.prompts).toHaveLength(2)
    expect(seen[0]?.signal).toBe(controller.signal)
    expect(result).toMatchObject({ behavior: "allow", updatedInput: { answers: { "用哪个日期库？": "date-fns" } } })
  })

  it("一题都解析不出来就照旧放行，不弹空卡", async () => {
    const result = await askQuestions({ questions: [] }, "t", () => Promise.reject(new Error("不该问")))
    expect(result).toEqual({ behavior: "allow" })
  })
})
