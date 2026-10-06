import { describe, expect, it, vi } from "vitest"
import type { QuestionResponse } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import type { ForeignInteraction } from "./caps.js"
import { createForeignInteractionCalls } from "./interaction.js"

function call(): { value: ServerCall; replies: unknown[] } {
  const replies: unknown[] = []
  return {
    value: {
      id: 3, method: "x.test/question", params: {},
      respond: (reply) => replies.push({ result: reply }),
      reject: (error) => replies.push({ error }),
    },
    replies,
  }
}

const interaction = (key = "tool-1"): ForeignInteraction => ({
  sessionId: "session-1",
  key,
  questions: [{ id: "q1", question: "Choose", options: [{ id: "a", label: "A" }] }],
  reply: (response) => ({ response }),
})

describe("ACP 私有阻塞交互账本", () => {
  it("宿主回答按引擎适配器的形状回送", async () => {
    const row = call()
    const ask = vi.fn<StartRequest["askQuestion"]>(() => Promise.resolve({
      answers: { q1: { kind: "single", optionId: "a" } },
    }))
    await createForeignInteractionCalls(ask).answer(row.value, interaction())
    expect(ask).toHaveBeenCalledWith(interaction().questions, { signal: expect.any(AbortSignal) })
    expect(row.replies).toEqual([{ result: { response: {
      answers: { q1: { kind: "single", optionId: "a" } },
    } } }])
  })

  it("其他客户端先回答时撤掉宿主等待，不发送迟到回包", async () => {
    const row = call()
    const ask = vi.fn<StartRequest["askQuestion"]>((_questions, wait) =>
      new Promise<QuestionResponse>((resolve) => {
        wait?.signal?.addEventListener("abort", () => resolve({ dismissed: true }), { once: true })
      }))
    const calls = createForeignInteractionCalls(ask)
    const answering = calls.answer(row.value, interaction())
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    calls.resolved("tool-1")
    await answering
    expect(row.replies).toEqual([])
  })

  it("会话释放会撤销全部问题；坏请求以 invalid params 收口", async () => {
    const waits: AbortSignal[] = []
    const ask: StartRequest["askQuestion"] = (_questions, wait) => new Promise((resolve) => {
      if (wait?.signal !== undefined) waits.push(wait.signal)
      wait?.signal?.addEventListener("abort", () => resolve({ dismissed: true }), { once: true })
    })
    const calls = createForeignInteractionCalls(ask)
    const first = call()
    const second = call()
    const pending = [calls.answer(first.value, interaction("a")), calls.answer(second.value, interaction("b"))]
    await vi.waitFor(() => expect(waits).toHaveLength(2))
    calls.abortAll()
    await Promise.all(pending)
    expect(waits.every((signal) => signal.aborted)).toBe(true)

    const malformed = call()
    await calls.answer(malformed.value, { ...interaction(), questions: [] })
    expect(malformed.replies).toEqual([{ error: {
      code: -32602, message: "x.test/question 没有可呈现的问题",
    } }])
  })
})
