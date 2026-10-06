import type { Event, PendingQuestion, QuestionResponse, Thread } from "@switchback/protocol"
import { describe, expect, it, vi } from "vitest"
import { create, setup } from "./host-fixture.js"
import { validQuestionResponse } from "./question.js"

const pending: PendingQuestion = {
  id: "qu-1",
  questions: [
    {
      id: "one",
      question: "选一个",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    },
    {
      id: "many",
      question: "选多个",
      options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }],
      multiSelect: true,
      allowOther: true,
    },
  ],
}

function latestThread(events: readonly Event[]): Thread | undefined {
  const event = events
    .filter((entry) => entry.type === "thread.started" || entry.type === "thread.updated")
    .at(-1)
  return event?.type === "thread.started" || event?.type === "thread.updated"
    ? event.thread
    : undefined
}

describe("结构化问题校验", () => {
  const cases: readonly { name: string; response: QuestionResponse; valid: boolean }[] = [
    { name: "整组跳过", response: { dismissed: true }, valid: true },
    {
      name: "单选加多选和自填",
      response: {
        answers: {
          one: { kind: "single", optionId: "b" },
          many: { kind: "multi_with_other", optionIds: ["x"], otherText: "补一项" },
        },
      },
      valid: true,
    },
    {
      name: "逐题跳过",
      response: { answers: { one: { kind: "skipped" }, many: { kind: "skipped" } } },
      valid: true,
    },
    {
      name: "漏题",
      response: { answers: { one: { kind: "single", optionId: "a" } } },
      valid: false,
    },
    {
      name: "伪造选项",
      response: {
        answers: { one: { kind: "single", optionId: "fake" }, many: { kind: "skipped" } },
      },
      valid: false,
    },
    {
      name: "单选题伪装多选",
      response: {
        answers: { one: { kind: "multi", optionIds: ["a"] }, many: { kind: "skipped" } },
      },
      valid: false,
    },
    {
      name: "空白自填",
      response: {
        answers: { one: { kind: "skipped" }, many: { kind: "other", text: "  " } },
      },
      valid: false,
    },
  ]

  it("只接受与当前问题逐题吻合的答案", () => {
    for (const entry of cases) {
      expect(validQuestionResponse(pending, entry.response), entry.name).toBe(entry.valid)
    }
  })

  it("备注只能进明确允许的题，纯自由回答不冒充选项", () => {
    const noteQuestion: PendingQuestion = {
      id: "qu-note",
      questions: [{ id: "note", question: "补充", options: [], allowNote: true }],
    }
    expect(validQuestionResponse(noteQuestion, {
      answers: { note: { kind: "note", text: "原文" } },
    })).toBe(true)
    expect(validQuestionResponse(pending, {
      answers: {
        one: { kind: "single", optionId: "a", note: "伪备注" },
        many: { kind: "skipped" },
      },
    })).toBe(false)
  })
})

describe("结构化问题往返", () => {
  it("多组问题可并存，落定一组只清掉自己", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = latestThread(events)?.id ?? ""
    const first = session().question(pending.questions)
    const second = session().question(pending.questions.slice(0, 1))
    const groups = latestThread(events)?.pendingQuestions ?? []
    expect(groups).toHaveLength(2)

    const response: QuestionResponse = {
      answers: { one: { kind: "single", optionId: "a" }, many: { kind: "skipped" } },
    }
    await host.dispatch({
      type: "question.resolve",
      threadId,
      questionId: groups[0]?.id ?? "",
      response,
    })

    await expect(first).resolves.toEqual(response)
    expect(latestThread(events)?.pendingQuestions).toEqual([groups[1]])
    await host.dispose()
    await expect(second).resolves.toEqual({ dismissed: true })
  })

  it("拒绝旧卡和不匹配答案，不把脏数据送进引擎", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const threadId = latestThread(events)?.id ?? ""
    void session().question(pending.questions)
    const questionId = latestThread(events)?.pendingQuestions?.[0]?.id ?? ""

    await expect(host.dispatch({
      type: "question.resolve",
      threadId,
      questionId,
      response: { answers: { one: { kind: "single", optionId: "fake" } } },
    })).rejects.toThrow("回答与当前问题不匹配")
    expect(latestThread(events)?.pendingQuestions).toHaveLength(1)
  })

  it("非阻塞问题到期自动清卡并按跳过落定", async () => {
    vi.useFakeTimers()
    const { host, events, session } = setup()
    try {
      await host.dispatch(create)
      const answer = session().question(pending.questions, { timeoutMs: 50 })
      expect(latestThread(events)?.pendingQuestions?.[0]?.expiresAt).toBe(50)
      await vi.advanceTimersByTimeAsync(50)
      await expect(answer).resolves.toEqual({ dismissed: true })
      expect(latestThread(events)?.pendingQuestions).toBeUndefined()
    } finally {
      await host.dispose()
      vi.useRealTimers()
    }
  })

  it("引擎撤销阻塞问题时立即解开并清卡", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const controller = new AbortController()
    const answer = session().question(pending.questions, { signal: controller.signal })
    expect(latestThread(events)?.pendingQuestions).toHaveLength(1)
    controller.abort()
    await expect(answer).resolves.toEqual({ dismissed: true })
    expect(latestThread(events)?.pendingQuestions).toBeUndefined()
    await host.dispose()
  })
})
