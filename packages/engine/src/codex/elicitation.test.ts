import { describe, expect, it, vi } from "vitest"
import type { ApprovalAnswer } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import { answerApproval } from "./approve.js"
import { elicitationResponse, MCP_ELICITATION } from "./elicitation.js"
import type { WireElicitationMeta, WireMcpElicitation } from "./wire.js"

const meta: WireElicitationMeta = {
  codex_approval_kind: "mcp_tool_call",
  connector_id: "computer-use",
  connector_name: "Computer Use",
  persist: ["session", "always"],
  riskLevel: "low",
  tool_name: "get_app_state",
  tool_params_display: [{ display_name: "App", name: "app", value: "switchback" }],
}

const params: WireMcpElicitation = {
  threadId: "th-native",
  turnId: "turn-native",
  serverName: "node_repl",
  mode: "form",
  _meta: meta,
  message: 'Allow Computer Use to use "switchback"?',
  requestedSchema: { type: "object", properties: {} },
}

function serverCall(value: WireMcpElicitation): { call: ServerCall; replies: unknown[] } {
  const replies: unknown[] = []
  return {
    call: {
      id: 17,
      method: MCP_ELICITATION,
      params: value,
      respond: (reply) => replies.push(reply),
      reject: (error) => replies.push({ error }),
    },
    replies,
  }
}

describe("Codex MCP elicitation", () => {
  it("Computer Use 的原生应用授权会进入 Switchback 审批卡，再按协议回给 app-server", async () => {
    const { call, replies } = serverCall(params)
    const askUser = vi.fn(() => Promise.resolve<ApprovalAnswer>({ allow: true, remember: "once" }))
    await answerApproval(call, {
      inflight: new Map(),
      cwd: "/w",
      home: "/home/u",
      trust: () => "auto-edit",
      memory: () => [],
      askUser,
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    expect(askUser).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: "mcp-elicitation-17",
      tool: "Computer Use",
      summary: 'Allow Computer Use to use "switchback"?',
      reason: "Computer Use 请求调用 get_app_state（App：switchback）",
      rememberHint: "Computer Use · App：switchback",
    }))
    expect(replies).toEqual([{ action: "accept", content: {}, _meta: null }])
  })

  it("三个选择原样映射成一次、会话、始终；拒绝不会误成 cancel", () => {
    const cases: readonly [ApprovalAnswer, unknown][] = [
      [{ allow: true, remember: "once" }, { action: "accept", content: {}, _meta: null }],
      [{ allow: true, remember: "session" }, { action: "accept", content: {}, _meta: { persist: "session" } }],
      [{ allow: true, remember: "project" }, { action: "accept", content: {}, _meta: { persist: "always" } }],
      [{ allow: false, remember: "once" }, { action: "decline", content: null, _meta: null }],
    ]
    for (const [answer, expected] of cases) expect(elicitationResponse(answer, meta)).toEqual(expected)
  })

  it("需要填写内容的表单明确 cancel，不伪造空答案也不打扰用户", async () => {
    const { call, replies } = serverCall({
      ...params,
      requestedSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    })
    const askUser = vi.fn(() => Promise.resolve<ApprovalAnswer>({ allow: true, remember: "once" }))
    await answerApproval(call, {
      inflight: new Map(),
      cwd: "/w",
      home: "/home/u",
      trust: () => "auto-edit",
      memory: () => [],
      askUser,
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    expect(askUser).not.toHaveBeenCalled()
    expect(replies).toEqual([{ action: "cancel", content: null, _meta: null }])
  })
})
