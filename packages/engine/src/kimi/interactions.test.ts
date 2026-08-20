import { describe, expect, it, vi } from "vitest"
import type { StartRequest } from "../contract.js"
import { KimiApiError, type KimiApi } from "./http.js"
import { KimiInteractions } from "./interactions.js"
import type { KimiApproval } from "./wire.js"

function approval(): KimiApproval {
  return {
    approval_id: "ap1",
    session_id: "s1",
    tool_call_id: "tc1",
    tool_name: "WebFetch",
    action: "Fetch dependency metadata",
    tool_input_display: { kind: "url_fetch", url: "https://registry.example/x" },
  }
}

describe("Kimi 审批", () => {
  it("完整原生参数经过判定器，人工允许会回 Kimi 的 session scope", async () => {
    const posts: { path: string; body: unknown }[] = []
    const asks: unknown[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string, body?: unknown) => {
        posts.push({ path, body })
        return Promise.resolve({} as T)
      },
    }
    const req: StartRequest = {
      threadId: "th1",
      cwd: "/work",
      trust: "auto-edit",
      home: "/home/u",
      memory: () => [],
      emit: () => undefined,
      askUser: (ask) => {
        asks.push(ask)
        return Promise.resolve({ allow: true, remember: "session" })
      },
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "auto-edit",
      onError: () => undefined,
      onQuestion: () => undefined,
    })

    interactions.approval(approval())
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(asks).toMatchObject([{ toolCallId: "tc1", tool: "WebFetch", redline: "network" }])
    expect(posts[0]).toEqual({
      path: "sessions/s1/approvals/ap1",
      body: { decision: "approved", scope: "session" },
    })
  })

  it("原生回写暂时失败后允许下一次快照重试，不把审批永久卡死", async () => {
    const errors: string[] = []
    const posts: string[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) => {
        posts.push(path)
        return posts.length === 1 ? Promise.reject(new Error("temporary")) : Promise.resolve({} as T)
      },
    }
    const req: StartRequest = {
      threadId: "th1",
      cwd: "/work",
      trust: "auto-edit",
      home: "/home/u",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "auto-edit",
      onError: (message) => errors.push(message),
      onQuestion: () => undefined,
    })

    interactions.approval(approval())
    await vi.waitFor(() => expect(errors).toEqual(["temporary"]))
    interactions.approval(approval())
    await vi.waitFor(() => expect(posts).toHaveLength(2))
  })

  it("当前协议装不下结构化问题时明确上报并走 Kimi 原生 dismiss，不伪造选项", async () => {
    const posts: string[] = []
    const notes: string[] = []
    const errors: string[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) => {
        posts.push(path)
        return Promise.reject(new KimiApiError(40909, "question dismissed")) as Promise<T>
      },
    }
    const req = {
      threadId: "th1",
      cwd: "/work",
      trust: "read-only" as const,
      home: "/home/u",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "read-only",
      onError: (message) => errors.push(message),
      onQuestion: (note) => notes.push(note),
    })

    interactions.question({
      question_id: "q1",
      session_id: "s1",
      questions: [{ id: "one", question: "选哪条？", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }],
    })
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(notes).toEqual(["选哪条？（A / B）"])
    expect(posts).toEqual(["sessions/s1/questions/q1:dismiss"])
    expect(errors).toEqual([])
  })
})
