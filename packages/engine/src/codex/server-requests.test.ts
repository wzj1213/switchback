import type { QuestionResponse } from "@switchback/protocol"
import { describe, expect, it, vi } from "vitest"
import type { StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import { createServerRequests } from "./server-requests.js"

function pendingQuestion(): {
  call: ServerCall
  replies: unknown[]
  askQuestion: StartRequest["askQuestion"]
} {
  const replies: unknown[] = []
  const askQuestion = vi.fn<StartRequest["askQuestion"]>((_questions, wait) => new Promise<QuestionResponse>((resolve) => {
    wait?.signal?.addEventListener("abort", () => resolve({ dismissed: true }), { once: true })
  }))
  return {
    call: {
      id: "reverse-1",
      method: "item/tool/requestUserInput",
      params: {
        isBlocking: true,
        questions: [{ id: "target", question: "Which target?", options: [] }],
      },
      respond: (reply) => replies.push(reply),
      reject: (error) => replies.push({ error }),
    },
    replies,
    askQuestion,
  }
}

function requests(askQuestion: StartRequest["askQuestion"]) {
  return createServerRequests({
    inflight: new Map(),
    cwd: "/work",
    home: "/home/dev",
    trust: () => "auto-edit",
    memory: () => [],
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion,
  })
}

function unsupported(method: string): { call: ServerCall; replies: unknown[] } {
  const replies: unknown[] = []
  return {
    call: {
      id: "unknown-1",
      method,
      params: {},
      respond: (result) => replies.push({ result }),
      reject: (error) => replies.push({ error }),
    },
    replies,
  }
}

describe("Codex 反向 RPC 生命周期", () => {
  it("未认领方法回顶层 method-not-found，不拿空对象冒充成功", async () => {
    const row = unsupported("item/tool/call")
    await requests(() => Promise.resolve({ dismissed: true })).answer(row.call)
    expect(row.replies).toEqual([{
      error: { code: -32601, message: "Switchback 未认领 item/tool/call" },
    }])
  })

  it("对端 resolved 会中止同 id 等待，并压掉迟到回包", async () => {
    const row = pendingQuestion()
    const server = requests(row.askQuestion)
    const answering = server.answer(row.call)
    await vi.waitFor(() => expect(row.askQuestion).toHaveBeenCalled())
    server.resolved(row.call.id)
    await answering
    expect(row.replies).toEqual([])
  })

  it("进程收口会一次撤销所有还挂着的请求", async () => {
    const row = pendingQuestion()
    const server = requests(row.askQuestion)
    const answering = server.answer(row.call)
    await vi.waitFor(() => expect(row.askQuestion).toHaveBeenCalled())
    server.abortAll()
    await answering
    expect(row.replies).toEqual([])
  })

  it("宿主交互异常会回 JSON-RPC 错误，不留下未处理拒绝并让整轮永远等待", async () => {
    const row = pendingQuestion()
    const server = requests(() => Promise.reject(new Error("交互面板失效")))
    await server.answer(row.call)
    expect(row.replies).toEqual([{ error: { code: -32603, message: "交互面板失效" } }])
  })
})
