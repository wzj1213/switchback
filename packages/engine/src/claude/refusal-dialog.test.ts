import { describe, expect, it, vi } from "vitest"
import type { QuestionResponse } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createPlanState } from "./plan.js"
import {
  answerRefusalDialog, refusalDialogOptions,
} from "./refusal-dialog.js"
import { createRetractionState, rememberMessage } from "./retraction.js"

const dialog = (payload: Record<string, unknown>) => ({
  dialogKind: "refusal_fallback_prompt",
  payload,
})

const payload = {
  originalModel: "claude-opus-4-1",
  fallbackModel: "claude-sonnet-4-6",
  guidanceText: "Please choose\ncarefully",
  retractedMessageUuids: ["wire-1"],
}

describe("Claude 原生拒答选择框", () => {
  it("展示两个原生动作，作答落定之前绝不提前撤回", async () => {
    const prompts: Parameters<StartRequest["askQuestion"]>[0][] = []
    const retracted: (readonly string[])[] = []
    let answer: ((response: QuestionResponse) => void) | undefined
    const ask: StartRequest["askQuestion"] = (questions) => {
      prompts.push(questions)
      return new Promise((resolve) => { answer = resolve })
    }
    const pending = answerRefusalDialog(
      dialog(payload), { askQuestion: ask }, new AbortController().signal, (uuids) => retracted.push(uuids),
    )
    expect(retracted).toEqual([])
    expect(prompts[0]?.[0]).toMatchObject({
      id: "claude-refusal-fallback",
      header: "Claude · 会话已暂停",
      body: "Please choose carefully",
      options: [
        { id: "retry_fallback", label: "切换到 claude-sonnet-4-6" },
        { id: "edit_prompt", label: "修改后继续用 claude-opus-4-1" },
      ],
    })
    answer?.({ answers: { "claude-refusal-fallback": { kind: "single", optionId: "retry_fallback" } } })
    await expect(pending).resolves.toEqual({ behavior: "completed", result: "retry_fallback" })
    expect(retracted).toEqual([["wire-1"]])
  })

  it("修改与关闭都按原生结果落定；未知 kind 和畸形载荷 fail closed", async () => {
    const cases = [
      {
        response: { answers: { "claude-refusal-fallback": { kind: "single", optionId: "edit_prompt" } } },
        result: "edit_prompt",
      },
      { response: { dismissed: true }, result: "cancelled" },
    ] as const
    for (const sample of cases) {
      const ask = (): Promise<QuestionResponse> => Promise.resolve(sample.response)
      await expect(answerRefusalDialog(dialog(payload), { askQuestion: ask }, new AbortController().signal, () => undefined))
        .resolves.toEqual({ behavior: "completed", result: sample.result })
    }
    const ask = vi.fn<StartRequest["askQuestion"]>(() => Promise.resolve({ dismissed: true }))
    await expect(answerRefusalDialog(
      { dialogKind: "future-dialog", payload }, { askQuestion: ask }, new AbortController().signal, () => undefined,
    )).resolves.toEqual({ behavior: "cancelled" })
    await expect(answerRefusalDialog(
      dialog({ ...payload, fallbackModel: 7 }), { askQuestion: ask }, new AbortController().signal, () => undefined,
    )).resolves.toEqual({ behavior: "cancelled" })
    expect(ask).not.toHaveBeenCalled()
  })

  it("轮次中止时撤销问题但保留半截现场", async () => {
    const controller = new AbortController()
    const retracted: (readonly string[])[] = []
    const ask: StartRequest["askQuestion"] = (_questions, wait) => new Promise((resolve) => {
      wait?.signal?.addEventListener("abort", () => resolve({ dismissed: true }), { once: true })
    })
    const pending = answerRefusalDialog(dialog(payload), { askQuestion: ask }, controller.signal, (uuids) => retracted.push(uuids))
    controller.abort()
    await expect(pending).resolves.toEqual({ behavior: "cancelled" })
    expect(retracted).toEqual([])
  })

  it("Options 只声明真实可渲染的 kind，并在选择落定后发一等撤回事件", async () => {
    const events: Parameters<StartRequest["emit"]>[0][] = []
    const retractions = createRetractionState()
    rememberMessage(retractions, "wire-1", "turn-1", ["item-1"])
    const options = refusalDialogOptions({
      emit: (event) => events.push(event),
      askQuestion: () => Promise.resolve({
        answers: { "claude-refusal-fallback": { kind: "single", optionId: "retry_fallback" } },
      }),
    }, { retractions, tools: new Map(), plan: createPlanState() })
    expect(options.supportedDialogKinds).toEqual(["refusal_fallback_prompt"])
    await expect(options.onUserDialog?.(
      dialog(payload), { signal: new AbortController().signal, requestId: "request-1" },
    )).resolves.toEqual({ behavior: "completed", result: "retry_fallback" })
    expect(events).toEqual([
      { type: "item.removed", at: expect.any(Number), turnId: "turn-1", itemId: "item-1" },
    ])
  })
})
