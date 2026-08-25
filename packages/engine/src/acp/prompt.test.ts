import { describe, expect, it } from "vitest"
import type { ForeignTurn } from "./caps.js"
import { AcpPromptBridge } from "./prompt.js"

interface PendingCall {
  method: string
  params: unknown
  resolve: (value: unknown) => void
}

describe("ACP prompt 主动续轮", () => {
  it("当前轮收工后发送排队任务，保留原文并合并引擎关联元数据", async () => {
    const calls: PendingCall[] = []
    const starts: unknown[] = []
    const completed: string[] = []
    const state = { acpSession: "session-1", turn: undefined as string | undefined, caps: { attachments: false } }
    const holder: { bridge?: AcpPromptBridge } = {}
    const bridge = new AcpPromptBridge({
      id: "grok",
      state,
      now: () => 9,
      promptMeta: (turnId) => ({ promptId: turnId, source: "base" }),
      begin: (request) => {
        if (state.turn !== undefined) return undefined
        starts.push(request)
        return "native-1"
      },
      rpc: {
        call: (method, params) => new Promise((resolve) => calls.push({ method, params, resolve })),
      },
      complete: (turnId) => {
        completed.push(turnId)
        state.turn = undefined
        holder.bridge?.settled(turnId)
      },
      fail: () => undefined,
    })
    holder.bridge = bridge
    const scheduled: ForeignTurn = {
      key: "job-1",
      prompt: "检查部署",
      origin: {
        kind: "scheduled", taskId: "job-1", schedule: "every minute",
        recurring: true, coalescedCount: 1, stale: false,
      },
      promptMeta: (turnId) => ({ promptId: `scheduler-fired-${turnId}` }),
    }

    await bridge.prompt("普通一轮", "host-1")
    bridge.enqueue(scheduled)
    expect(calls).toHaveLength(1)
    calls[0]?.resolve({ stopReason: "end_turn" })
    await Promise.resolve()
    await Promise.resolve()

    expect(starts).toEqual([{ at: 9, prompt: "检查部署", origin: scheduled.origin }])
    expect(calls[1]).toMatchObject({
      method: "session/prompt",
      params: {
        sessionId: "session-1",
        prompt: [{ type: "text", text: "检查部署" }],
        _meta: { promptId: "scheduler-fired-native-1", source: "base" },
      },
    })
    expect(completed).toEqual(["host-1"])
  })
})
