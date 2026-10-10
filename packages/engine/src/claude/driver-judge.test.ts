import { describe, expect, it, vi } from "vitest"
import type { QuestionResponse } from "@switchback/protocol"
import type { ApprovalAnswer, ApprovalAsk, InteractionWait } from "../contract.js"

// 只截 `canUseTool`：消息循环挂着不动，其余方法一律回空
const sdk = vi.hoisted(() => ({ options: undefined as undefined | Record<string, unknown> }))
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options = options
    const target = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
    }
    return new Proxy(target, {
      get: (object, key) => (key in object ? (object as Record<PropertyKey, unknown>)[key] : () => Promise.resolve(undefined)),
    })
  },
}))

const { createClaudeDriver } = await import("./driver.js")

type CanUseTool = (tool: string, input: Record<string, unknown>, meta: Record<string, unknown>) => Promise<unknown>

interface Seen {
  asks: { ask: ApprovalAsk; wait?: InteractionWait }[]
  questions: number
}

async function judgeWith(answer: ApprovalAnswer, response: QuestionResponse = { dismissed: true }): Promise<{ canUseTool: CanUseTool; seen: Seen }> {
  const seen: Seen = { asks: [], questions: 0 }
  await createClaudeDriver().start({
    threadId: "th-1",
    cwd: "/work/proj",
    home: "/home/u",
    trust: "auto-edit",
    memory: () => [],
    emit: () => undefined,
    askUser: (ask, wait) => {
      seen.asks.push({ ask, ...(wait === undefined ? {} : { wait }) })
      return Promise.resolve(answer)
    },
    askQuestion: () => {
      seen.questions += 1
      return Promise.resolve(response)
    },
  })
  return { canUseTool: sdk.options?.["canUseTool"] as CanUseTool, seen }
}

const push = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "git push *" }], behavior: "allow", destination: "localSettings" }

describe("Claude canUseTool", () => {
  it("AskUserQuestion 出问题卡，答案按 SDK 公开字段交回", async () => {
    const { canUseTool, seen } = await judgeWith(
      { allow: true, remember: "once" },
      { answers: { "toolu_q:q0": { kind: "single", optionId: "B" } } },
    )
    const result = await canUseTool("AskUserQuestion", {
      questions: [{ question: "用哪个？", header: "库", multiSelect: false, options: [{ label: "A", description: "" }, { label: "B", description: "" }] }],
    }, { signal: new AbortController().signal, toolUseID: "toolu_q", requestId: "r1" })
    expect(seen.questions).toBe(1)
    expect(seen.asks).toHaveLength(0)
    expect(result).toMatchObject({ behavior: "allow", updatedInput: { answers: { "用哪个？": "B" } } })
  })

  it("红线卡选「此对话」也不让 CLI 记规则；撤回信号交给宿主", async () => {
    const { canUseTool, seen } = await judgeWith({ allow: true, remember: "session" })
    const signal = new AbortController().signal
    const result = await canUseTool("Bash", { command: "git push origin main" }, {
      signal, toolUseID: "toolu_p", requestId: "r2", suggestions: [push],
    })
    expect(seen.asks[0]?.ask.redline).toBe("git-push")
    expect(seen.asks[0]?.wait?.signal).toBe(signal)
    expect(result).toEqual({ behavior: "allow" })
  })

  it("用户 ask 规则强制的卡：本轮放行吞不掉，理由写明是哪条规则", async () => {
    const { canUseTool, seen } = await judgeWith({ allow: true, remember: "session" })
    const result = await canUseTool("Bash", { command: "git commit -m x" }, {
      signal: new AbortController().signal, toolUseID: "toolu_c", requestId: "r3", suggestions: [push],
      matchedAskRule: { source: "userSettings", toolName: "Bash", ruleContent: "git commit:*" },
    })
    expect(seen.asks[0]?.ask).toMatchObject({
      redline: "claude-ask-rule",
      reason: "Claude 设置里的 ask 规则要求逐项确认：Bash(git commit:*)",
    })
    expect(result).toEqual({ behavior: "allow" })
  })
})

describe("没人能问时", () => {
  it("照实告诉模型：会话已经关了、没有人确认，不说成用户拒绝", async () => {
    const { canUseTool } = await judgeWith({ allow: false, remember: "once", unattended: true })
    const result = await canUseTool("Bash", { command: "git push origin main" }, {
      signal: new AbortController().signal, toolUseID: "toolu_bg", requestId: "r9",
    })
    expect(result).toEqual({ behavior: "deny", message: "会话已经关闭，没有人能确认这次调用，所以没有执行" })
  })
})

describe("子 agent 来要权限", () => {
  const cases = [
    { name: "SDK 报了 agentID：照原样标出来，宿主据此不让「本轮都放行」吞掉它", meta: { agentID: "agent-7" }, want: { kind: "subagent", id: "agent-7" } },
    { name: "主 agent 自己要的：不带来源", meta: {}, want: undefined },
  ]
  for (const one of cases) {
    it(one.name, async () => {
      const { canUseTool, seen } = await judgeWith({ allow: true, remember: "once" })
      await canUseTool("Bash", { command: "git push origin main" }, {
        signal: new AbortController().signal, toolUseID: "toolu_s", requestId: "r10", ...one.meta,
      })
      expect(seen.asks[0]?.ask.origin).toEqual(one.want)
    })
  }
})
