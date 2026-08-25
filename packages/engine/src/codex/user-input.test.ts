import { describe, expect, it, vi } from "vitest"
import type { QuestionResponse } from "@omni/protocol"
import type { ServerCall } from "../rpc.js"
import {
  answerUserInput,
  NON_BLOCKING_TIMEOUT_MS,
  userInputPrompts,
  userInputResponse,
  type WireUserInputRequest,
} from "./user-input.js"

function serverCall(params: WireUserInputRequest): { call: ServerCall; replies: unknown[] } {
  const replies: unknown[] = []
  return {
    call: {
      id: 9, method: "item/tool/requestUserInput", params,
      respond: (reply) => replies.push(reply),
      reject: (error) => replies.push({ error }),
    },
    replies,
  }
}

const request: WireUserInputRequest = {
  isBlocking: false,
  questions: [
    {
      id: "target", header: "Target", question: "Which target?", isOther: true, isSecret: true,
      options: [
        { label: "Core", description: "Inspect core" },
        { label: "TUI", description: "Inspect TUI" },
      ],
    },
    { id: "details", header: "Details", question: "Anything else?", isOther: true, options: null },
  ],
}

describe("Codex 结构化问题", () => {
  it("选项、可附备注、纯自由回答与秘密标记都保留", () => {
    expect(userInputPrompts(request)).toEqual([
      {
        id: "target", header: "Target", question: "Which target?", secret: true,
        options: [
          { id: "Core", label: "Core", description: "Inspect core" },
          { id: "TUI", label: "TUI", description: "Inspect TUI" },
        ],
        allowNote: true, noteLabel: "补充说明（可选）", noteDescription: "可选：补充上下文",
        allowOther: true, otherLabel: "以上都不是", otherDescription: "写下你的答案", optional: true,
      },
      {
        id: "details", header: "Details", question: "Anything else?", options: [],
        allowNote: true, noteLabel: "回答", noteDescription: "输入回答", optional: true,
      },
    ])
  })

  it("按 Codex 原生 label + user_note 数组回送", () => {
    const response: QuestionResponse = { answers: {
      target: { kind: "single", optionId: "TUI", note: "include snapshots" },
      details: { kind: "note", text: "SDK wrapper" },
    } }
    expect(userInputResponse(response)).toEqual({ answers: {
      target: { answers: ["TUI", "user_note: include snapshots"] },
      details: { answers: ["user_note: SDK wrapper"] },
    } })
  })

  it("以上都不是沿用 Codex 原生标签并附自由说明", () => {
    expect(userInputResponse({ answers: {
      target: { kind: "other", text: "SDK wrapper" },
      details: { kind: "skipped" },
    } })).toEqual({ answers: {
      target: { answers: ["None of the above", "user_note: SDK wrapper"] },
      details: { answers: [] },
    } })
  })

  it("非阻塞请求带 120 秒宿主收口，人回答后落原生回包", async () => {
    const row = serverCall(request)
    const askQuestion = vi.fn(() => Promise.resolve<QuestionResponse>({ dismissed: true }))
    const controller = new AbortController()
    await answerUserInput(row.call, { askQuestion, signal: controller.signal })
    expect(askQuestion).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      signal: expect.any(AbortSignal), timeoutMs: NON_BLOCKING_TIMEOUT_MS,
    }))
    expect(row.replies).toEqual([{ answers: {} }])
  })

  it("对端明确给自动收口时刻就原样采用，不把五秒问题拖成两分钟", async () => {
    const row = serverCall({ ...request, autoResolutionMs: 5_000 })
    const askQuestion = vi.fn(() => Promise.resolve<QuestionResponse>({ dismissed: true }))
    await answerUserInput(row.call, { askQuestion })
    expect(askQuestion).toHaveBeenCalledWith(expect.any(Array), { timeoutMs: 5_000 })
  })

  it("对端先撤销时解开等待且不补发过期回包", async () => {
    const row = serverCall({ ...request, isBlocking: true })
    const controller = new AbortController()
    const askQuestion = vi.fn((_questions, wait) => new Promise<QuestionResponse>((resolve) => {
      wait?.signal?.addEventListener("abort", () => resolve({ dismissed: true }), { once: true })
    }))
    const answering = answerUserInput(row.call, { askQuestion, signal: controller.signal })
    await vi.waitFor(() => expect(askQuestion).toHaveBeenCalled())
    controller.abort()
    await answering
    expect(row.replies).toEqual([])
  })

  it("空题、重复题号和畸形选项都不会造出伪回答", () => {
    expect(userInputPrompts({ questions: [
      { id: "same", question: "A", options: [{ label: "x", description: "" }] },
      { id: "same", question: "B", options: [] },
      { id: "", question: "bad", options: [] },
    ] })).toHaveLength(1)
    expect(userInputResponse({ answers: { same: { kind: "skipped" } } })).toEqual({
      answers: { same: { answers: [] } },
    })
  })
})
