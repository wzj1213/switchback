import { describe, expect, it } from "vitest"
import type { Event, ToolCallItem } from "@omni/protocol"
import {
  applyResultDenials, applyToolResult, clearDenials, createDenialState, onPermissionDenied,
} from "./denials.js"

const call = (): ToolCallItem => ({
  id: "tool-1", turnId: "turn-1", at: 1, kind: "tool_call", tool: "Bash", status: "running",
  detail: { kind: "shell", command: "sudo -n true" },
})

describe("Claude 权限拒绝", () => {
  it("自动拒绝提示立即落 denied，tool_result 只补输出不改回 failed", () => {
    const state = createDenialState()
    const tools = new Map([["tool-1", call()]])
    const events: Event[] = []
    onPermissionDenied({
      subtype: "permission_denied", tool_use_id: "tool-1", message: "don't ask mode",
    }, state, tools, { at: 2, emit: (event) => events.push(event) })
    const item = applyToolResult({ toolUseId: "tool-1", text: "don't ask mode", isError: true }, state, tools)

    expect(tools.size).toBe(0)
    expect(events).toEqual([expect.objectContaining({
      type: "item.updated", item: expect.objectContaining({ status: "denied", error: "don't ask mode" }),
    })])
    expect(item).toMatchObject({ status: "denied", detail: { output: "don't ask mode" } })
  })

  it("没有 advisory 的宿主拒绝由 result 权威清单从 failed 改成 denied", () => {
    const state = createDenialState()
    const tools = new Map([["tool-1", call()]])
    const failed = applyToolResult({ toolUseId: "tool-1", text: "用户拒绝", isError: true }, state, tools)
    const events: Event[] = []
    applyResultDenials({ permission_denials: [
      { tool_name: "Bash", tool_use_id: "tool-1", tool_input: { command: "pwd" } },
      { tool_name: "Bash", tool_use_id: "tool-1", tool_input: { command: "pwd" } },
    ] }, state, tools, { at: 3, emit: (event) => events.push(event) })

    expect(failed?.status).toBe("failed")
    expect(events).toEqual([expect.objectContaining({
      type: "item.updated", item: expect.objectContaining({ status: "denied", error: "用户拒绝" }),
    })])
  })

  it("权威清单可直接收掉漏了 tool_result 的调用，畸形和陌生 id 保持静默", () => {
    const state = createDenialState()
    const tools = new Map([["tool-1", call()]])
    const events: Event[] = []
    applyResultDenials({ permission_denials: [null, { tool_use_id: 42 }, { tool_use_id: "other" },
      { tool_use_id: "tool-1" }] }, state, tools, { at: 3, emit: (event) => events.push(event) })
    expect(tools.size).toBe(0)
    expect(events).toEqual([expect.objectContaining({
      item: expect.objectContaining({ id: "tool-1", status: "denied" }),
    })])
    clearDenials(state)
    expect(state.settled.size).toBe(0)
  })
})
