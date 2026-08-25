import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { emitElicitationComplete } from "./elicitation-complete.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude MCP 外部交互完成确认", () => {
  it("保留服务与交互 id，并清掉可伪造横幅的控制字符", () => {
    const events: Event[] = []
    emitElicitationComplete({
      mcp_server_name: "vault\nserver", elicitation_id: "auth\t42",
    }, { threadId: "thread-1", at: 9, emit: (event) => events.push(event) })
    expect(events).toEqual([{
      type: "engine.notification", at: 9, threadId: "thread-1", engine: "claude",
      key: "elicitation-complete:vault server:auth 42",
      message: "MCP 服务“vault server”已确认外部交互完成（auth 42）",
      priority: "low", timeoutMs: 8000,
    }])
  })

  it.each([
    { mcp_server_name: "", elicitation_id: "id" },
    { mcp_server_name: "vault", elicitation_id: 1 },
  ])("坏载荷静默略过：%o", (message) => {
    const events: Event[] = []
    emitElicitationComplete(message, {
      threadId: "thread-1", at: 1, emit: (event) => events.push(event),
    })
    expect(events).toEqual([])
  })

  it("消息循环在原轮次结束后仍显示原生完成确认", async () => {
    const events: Event[] = []
    await runMessageLoop(stream([{
      type: "system", subtype: "elicitation_complete",
      mcp_server_name: "vault", elicitation_id: "auth-42",
    }]), request(events), createTurnRef(() => undefined), () => "auto-edit")
    expect(events[0]).toMatchObject({
      type: "engine.notification", message: expect.stringContaining("vault"),
    })
  })
})
