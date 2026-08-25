import { describe, expect, it, vi } from "vitest"
import type { ApprovalAnswer } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import { answerApproval, type AnswerDeps } from "./approve.js"
import { PERMISSIONS_APPROVAL, permissionsSummary, type WirePermissionsRequest } from "./permissions.js"

function serverCall(method: string, params: WirePermissionsRequest): { call: ServerCall; replies: unknown[] } {
  const replies: unknown[] = []
  return {
    call: {
      id: 7, method, params,
      respond: (reply) => { replies.push(reply) },
      reject: (error) => { replies.push({ error }) },
    },
    replies,
  }
}

function deps(answer: ApprovalAnswer, trust: AnswerDeps["trust"] = () => "auto-edit"): AnswerDeps {
  return {
    inflight: new Map(),
    cwd: "/work",
    home: "/home/dev",
    trust,
    memory: () => [],
    askUser: vi.fn(() => Promise.resolve(answer)),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

const request = (permissions: WirePermissionsRequest["permissions"]): WirePermissionsRequest => ({
  itemId: "permission-1",
  cwd: "/work",
  reason: "tool needs broader access",
  permissions,
})

describe("Codex 权限 profile 审批", () => {
  it("网络权限在自动编辑档问人，允许后按原形状回送", async () => {
    const row = serverCall(PERMISSIONS_APPROVAL, request({ network: { enabled: true }, fileSystem: null }))
    const d = deps({ allow: true, remember: "session" })
    await answerApproval(row.call, d)
    expect(d.askUser).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: "permission-1",
      summary: expect.stringContaining("访问网络"),
    }))
    expect(row.replies).toEqual([{ permissions: { network: { enabled: true } }, scope: "session" }])
  })

  it("拒绝和只读档都回必填的空 profile，不再回错形状 decision", async () => {
    const cases = [
      { trust: "auto-edit" as const, answer: { allow: false, remember: "session" as const } },
      { trust: "read-only" as const, answer: { allow: true, remember: "once" as const } },
    ]
    for (const row of cases) {
      const server = serverCall(PERMISSIONS_APPROVAL, request({ network: { enabled: true }, fileSystem: null }))
      await answerApproval(server.call, deps(row.answer, () => row.trust))
      expect(server.replies).toEqual([{ permissions: {}, scope: "turn" }])
    }
  })

  it("工作区内额外写权在自动编辑档直接放行，工作区外仍弹卡", async () => {
    const inside = request({ network: null, fileSystem: { read: null, write: ["/work/out"], entries: [] } })
    const outside = request({ network: null, fileSystem: { read: null, write: ["/tmp/out"], entries: [] } })
    const allowed = serverCall(PERMISSIONS_APPROVAL, inside)
    const asked = serverCall(PERMISSIONS_APPROVAL, outside)
    const direct = deps({ allow: false, remember: "once" })
    const human = deps({ allow: true, remember: "once" })
    await answerApproval(allowed.call, direct)
    await answerApproval(asked.call, human)
    expect(direct.askUser).not.toHaveBeenCalled()
    expect(allowed.replies[0]).toMatchObject({ permissions: { fileSystem: { write: ["/work/out"] } } })
    expect(human.askUser).toHaveBeenCalledWith(expect.objectContaining({ redline: "write-outside-worksite" }))
  })

  it("新增的其他 requestApproval 不冒充工具审批，并明确报不支持", async () => {
    const row = serverCall("item/future/requestApproval", request({ network: { enabled: true } }))
    const d = deps({ allow: true, remember: "once" })
    await answerApproval(row.call, d)
    expect(row.replies).toEqual([{
      error: { code: -32601, message: "omni 未认领 item/future/requestApproval" },
    }])
    expect(d.askUser).not.toHaveBeenCalled()
  })

  it("摘要保留具体读写范围，并清理对端文本", () => {
    const summary = permissionsSummary(request({
      network: { enabled: true },
      fileSystem: {
        read: ["/work/a"], write: null,
        entries: [{ access: "write", path: { type: "glob_pattern", pattern: "/tmp/*" } }],
      },
    }))
    expect(summary).toContain("访问网络")
    expect(summary).toContain("读取 /work/a")
    expect(summary).toContain("写入 glob:/tmp/*")
  })
})
