import { describe, expect, it } from "vitest"
import type { Event, ToolCallItem } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createPlanState } from "./plan.js"
import {
  createRetractionState, rememberMessage, retractMessages,
} from "./retraction.js"
import { createTurnRef, runMessageLoop, type TurnRef } from "./loop.js"

function stream(messages: readonly unknown[]): never {
  return { async *[Symbol.asyncIterator]() { for (const message of messages) yield message } } as never
}

function ref(): TurnRef {
  const out = createTurnRef(() => undefined)
  out.current = "turn-1"
  return out
}

function request(events: Event[], models: string[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event), onModel: (model) => { if (model !== undefined) models.push(model) },
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude 拒答回退", () => {
  it("replacement 到达即撤回旧正文和工具，结算通知幂等且同步会话模型", async () => {
    const events: Event[] = []
    const models: string[] = []
    await runMessageLoop(stream([
      { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "拒答前的半截" }] } },
      { type: "assistant", uuid: "a2", message: { content: [
        { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } },
      ] } },
      { type: "user", uuid: "u1", message: { content: [
        { type: "tool_result", tool_use_id: "tool-1", content: "done", is_error: false },
      ] } },
      {
        type: "assistant", uuid: "a3", supersedes: ["a1", "a2", "u1"],
        message: { content: [{ type: "text", text: "回退后的正式答案" }] },
      },
      {
        type: "system", subtype: "model_refusal_fallback", direction: "retry", scope: "session",
        original_model: "claude-opus-4-1", fallback_model: "claude-sonnet-4-6",
        retracted_message_uuids: ["a1", "a2", "u1"], content: "Claude 已切换模型并重试。",
      },
      { type: "result", subtype: "success", is_error: false },
    ]), request(events, models), ref(), () => "auto-edit")

    expect(events.filter((event) => event.type === "item.removed")).toEqual([
      { type: "item.removed", at: expect.any(Number), turnId: "turn-1", itemId: "turn-1:i1" },
      { type: "item.removed", at: expect.any(Number), turnId: "turn-1", itemId: "tool-1" },
    ])
    expect(events.find((event) => event.type === "item.started" && event.item.kind === "agent_message" &&
      event.item.text === "回退后的正式答案")).toBeDefined()
    expect(events.find((event) => event.type === "item.started" && event.item.kind === "notice")).toMatchObject({
      item: { message: "Claude 已切换模型并重试。", level: "warning" },
    })
    expect(models).toEqual(["claude-sonnet-4-6"])
    expect(events.filter((event) => event.type === "item.updated" && event.item.id === "tool-1")).toHaveLength(1)
  })

  it("无回退时保留 SDK 原始说明，不拿类别字段另拼一句", async () => {
    const events: Event[] = []
    await runMessageLoop(stream([
      {
        type: "system", subtype: "model_refusal_no_fallback", original_model: "claude-opus-4-1",
        api_refusal_category: "future-category", content: "The selected model declined this request.",
      },
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["refusal"] },
    ]), request(events, []), ref(), () => "auto-edit")
    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      item: { kind: "error", message: "The selected model declined this request.", fatal: false },
    })
  })

  it("撤回计划卡会同时清掉派生计划状态，避免后续更新写向已删除 item", () => {
    const state = createRetractionState()
    const plan = createPlanState()
    plan.itemId = "plan-1"
    plan.steps.set("1", { text: "旧步骤", status: "pending" })
    const tool: ToolCallItem = {
      id: "tool-1", turnId: "turn-1", at: 0, kind: "tool_call", tool: "Bash", status: "running",
      detail: { kind: "shell", command: "pwd" },
    }
    const tools = new Map([["native-tool", tool]])
    const settledTools = new Map([["tool-1", tool]])
    const denialMessages = new Map([["tool-1", "denied"]])
    const events: Event[] = []
    rememberMessage(state, "wire-1", "turn-1", ["plan-1", "tool-1"])
    retractMessages(state, ["wire-1"], {
      at: 1, emit: (event) => events.push(event), tools, plan, settledTools, denialMessages,
    })
    expect(events.filter((event) => event.type === "item.removed")).toHaveLength(2)
    expect(plan).toEqual({ itemId: undefined, steps: new Map() })
    expect(tools.size).toBe(0)
    expect([settledTools.size, denialMessages.size]).toEqual([0, 0])
  })
})
