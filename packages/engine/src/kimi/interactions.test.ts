import { describe, expect, it, vi } from "vitest"
import type { QuestionPrompt, QuestionResponse } from "@switchback/protocol"
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
      askQuestion: () => Promise.resolve({ dismissed: true }),
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "auto-edit",
      onError: () => undefined,
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
        return posts.length === 1
          ? Promise.reject(new Error("temporary"))
          : Promise.resolve({} as T)
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
      askQuestion: () => Promise.resolve({ dismissed: true }),
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "auto-edit",
      onError: (message) => errors.push(message),
    })

    interactions.approval(approval())
    await vi.waitFor(() => expect(errors).toEqual(["temporary"]))
    interactions.approval(approval())
    await vi.waitFor(() => expect(posts).toHaveLength(2))
  })

  it("审批已在另一客户端落定时撤销宿主等待，不再补发一次拒绝", async () => {
    const posts: string[] = []
    let signal: AbortSignal | undefined
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) => {
        posts.push(path)
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
      askUser: (_ask, wait) => {
        signal = wait?.signal
        return new Promise((resolve) => {
          wait?.signal?.addEventListener(
            "abort",
            () => resolve({ allow: false, remember: "once" }),
            { once: true },
          )
        })
      },
      askQuestion: () => Promise.resolve({ dismissed: true }),
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "auto-edit",
      onError: () => undefined,
    })

    interactions.approval(approval())
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(interactions.handle({ type: "event.approval.resolved", approval_id: "ap1" })).toBe(true)
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    expect(posts).toEqual([])
  })

  it("把 Kimi 的结构化问题原样递出，并把逐题回答翻回原生字段", async () => {
    const posts: { path: string; body: unknown }[] = []
    const prompts: (readonly QuestionPrompt[])[] = []
    const errors: string[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string, body?: unknown) => {
        posts.push({ path, body })
        return Promise.resolve({} as T)
      },
    }
    const response: QuestionResponse = {
      answers: {
        one: { kind: "single", optionId: "b" },
        many: { kind: "multi_with_other", optionIds: ["x"], otherText: "自填" },
      },
    }
    const req: StartRequest = {
      threadId: "th1",
      cwd: "/work",
      trust: "read-only",
      home: "/home/u",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: (questions) => {
        prompts.push(questions)
        return Promise.resolve(response)
      },
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "read-only",
      onError: (message) => errors.push(message),
    })

    interactions.question({
      question_id: "q1",
      session_id: "s1",
      questions: [
        {
          id: "one",
          header: "路径",
          body: "选一个方案",
          question: "选哪条？",
          options: [
            { id: "a", label: "A", description: "稳妥" },
            { id: "b", label: "B" },
          ],
        },
        {
          id: "many",
          question: "还要哪些？",
          options: [{ id: "x", label: "X" }],
          multi_select: true,
          allow_other: true,
          other_label: "补充",
          other_description: "可写自己的答案",
        },
      ],
    })
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(prompts).toEqual([
      [
        {
          id: "one",
          header: "路径",
          body: "选一个方案",
          question: "选哪条？",
          options: [
            { id: "a", label: "A", description: "稳妥" },
            { id: "b", label: "B" },
          ],
        },
        {
          id: "many",
          question: "还要哪些？",
          options: [{ id: "x", label: "X" }],
          multiSelect: true,
          allowOther: true,
          otherLabel: "补充",
          otherDescription: "可写自己的答案",
        },
      ],
    ])
    expect(posts).toEqual([
      {
        path: "sessions/s1/questions/q1",
        body: {
          answers: {
            one: { kind: "single", option_id: "b" },
            many: { kind: "multi_with_other", option_ids: ["x"], other_text: "自填" },
          },
          method: "click",
        },
      },
    ])
    expect(errors).toEqual([])
  })

  it("用户跳过时走 Kimi 原生 dismiss，已被服务端关闭也不误报", async () => {
    const posts: string[] = []
    const errors: string[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) => {
        posts.push(path)
        return Promise.reject(new KimiApiError(40909, "question dismissed")) as Promise<T>
      },
    }
    const req: StartRequest = {
      threadId: "th1",
      cwd: "/work",
      trust: "read-only",
      home: "/home/u",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "read-only",
      onError: (message) => errors.push(message),
    })

    interactions.question({
      question_id: "q1",
      session_id: "s1",
      questions: [{ id: "one", question: "选哪条？", options: [] }],
    })
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(posts).toEqual(["sessions/s1/questions/q1:dismiss"])
    expect(errors).toEqual([])
  })

  it("问题从原生界面回答或从快照消失时同步撤销宿主问题卡", async () => {
    const signals: AbortSignal[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>() => Promise.resolve({} as T),
    }
    const req: StartRequest = {
      threadId: "th1",
      cwd: "/work",
      trust: "read-only",
      home: "/home/u",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: (_questions, wait) => {
        if (wait?.signal !== undefined) signals.push(wait.signal)
        return new Promise((resolve) => {
          wait?.signal?.addEventListener("abort", () => resolve({ dismissed: true }), {
            once: true,
          })
        })
      },
    }
    const interactions = new KimiInteractions({
      api,
      sessionId: "s1",
      req,
      trust: () => "read-only",
      onError: () => undefined,
    })
    const question = {
      question_id: "q1",
      session_id: "s1",
      questions: [{ id: "one", question: "选哪条？", options: [] }],
    } as const

    interactions.question(question)
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    interactions.handle({ type: "event.question.answered", question_id: "q1" })
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true))

    expect(
      interactions.handle({
        type: "event.question.requested",
        agentId: "subagent-1",
        question_id: "q2",
        questions: question.questions,
      }),
    ).toBe(true)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    interactions.reconcile([], [])
    await vi.waitFor(() => expect(signals[1]?.aborted).toBe(true))
  })
})

describe("子 agent 来要权限", () => {
  const cases = [
    { name: "帧上带着子 agent 的 agentId：照原样标出来", agentId: "subagent-1", want: { kind: "subagent", id: "subagent-1" } },
    { name: "主 agent 自己要的：不带来源", agentId: "main", want: undefined },
  ]
  for (const one of cases) {
    it(one.name, async () => {
      const asks: { origin?: unknown }[] = []
      const req: StartRequest = {
        threadId: "th1", cwd: "/work", trust: "auto-edit", home: "/home/u", memory: () => [], emit: () => undefined,
        askUser: (ask) => {
          asks.push(ask)
          return Promise.resolve({ allow: false, remember: "once" })
        },
        askQuestion: () => Promise.resolve({ dismissed: true }),
      }
      const api: KimiApi = { get: <T>() => Promise.resolve(undefined as T), post: <T>() => Promise.resolve({} as T) }
      const interactions = new KimiInteractions({ api, sessionId: "s1", req, trust: () => "auto-edit", onError: () => undefined })
      interactions.handle({
        type: "event.approval.requested", agentId: one.agentId, approval_id: `ap-${one.agentId}`,
        tool_call_id: "tc1", tool_name: "WebFetch", action: "Fetch", tool_input_display: { kind: "url_fetch", url: "https://registry.example/x" },
      })
      await vi.waitFor(() => expect(asks).toHaveLength(1))
      expect(asks[0]?.origin).toEqual(one.want)
    })
  }
})
