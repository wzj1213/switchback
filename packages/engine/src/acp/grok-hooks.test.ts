import { describe, expect, it } from "vitest"
import { grokHookItems, grokPromptMeta } from "./grok-hooks.js"

const notification = (runs: readonly unknown[], patch: Record<string, unknown> = {}): unknown => ({
  sessionId: "s",
  _meta: { promptId: "turn-1" },
  update: {
    sessionUpdate: "hook_execution",
    event_name: "pre_tool_use",
    tool_name: "shell",
    runs,
    ...patch,
  },
})

describe("Grok HookExecution", () => {
  it("保留慢成功、失败与阻止结果，短且无输出的成功和 skipped 保持安静", () => {
    expect(grokHookItems("_x.ai/session_notification", notification([
      { name: "quiet", status: { status: "success", elapsedMs: 20 } },
      { name: "slow", status: { status: "success", elapsedMs: 420 }, output: "checked" },
      { name: "broken", status: { status: "failed", error: "exit 2", elapsedMs: 12, blocked: false } },
      { name: "guard", status: { status: "failed", error: "policy denied", elapsedMs: 8, blocked: true } },
      { name: "disabled", status: { status: "skipped" } },
    ]))).toEqual([
      {
        tool: "hook/pre_tool_use", status: "ok", promptId: "turn-1",
        detail: {
          kind: "other", name: "slow", input: { event: "pre_tool_use", toolName: "shell", elapsedMs: 420 },
          output: "checked",
        },
      },
      {
        tool: "hook/pre_tool_use", status: "failed", error: "exit 2", promptId: "turn-1",
        detail: {
          kind: "other", name: "broken", input: { event: "pre_tool_use", toolName: "shell", elapsedMs: 12 },
        },
      },
      {
        tool: "hook/pre_tool_use", status: "denied", error: "policy denied", promptId: "turn-1",
        detail: {
          kind: "other", name: "guard", input: { event: "pre_tool_use", toolName: "shell", elapsedMs: 8 },
        },
      },
    ])
  })

  it("没有工具名的 stop Hook 仍保留原生事件，畸形字段不编结果", () => {
    expect(grokHookItems("_x.ai/session_notification", notification([
      { name: "stop-check", status: { status: "failed", error: "keep working", blocked: true } },
      { name: "", status: { status: "failed", error: "bad", blocked: false } },
    ], { event_name: "stop", tool_name: undefined }))).toEqual([{
      tool: "hook/stop", status: "denied", error: "keep working", promptId: "turn-1",
      detail: { kind: "other", name: "stop-check", input: { event: "stop" } },
    }])
  })

  it("别的方法、事件或缺批次时不认", () => {
    expect(grokHookItems("session/update", notification([]))).toBeUndefined()
    expect(grokHookItems("_x.ai/session_notification", {
      update: { sessionUpdate: "hook_annotation", message: "x" },
    })).toBeUndefined()
    expect(grokHookItems("_x.ai/session_notification", notification([], { event_name: "" }))).toBeUndefined()
    expect(grokHookItems("_x.ai/session_notification", notification([], { runs: null }))).toBeUndefined()
  })

  it("stop 批次自己的 prompt_id 优先于通知外层当前值", () => {
    const got = grokHookItems("_x.ai/session_notification", notification([
      { name: "stop-check", status: { status: "failed", error: "late", blocked: false } },
    ], { event_name: "stop", prompt_id: "turn-old" }))
    expect(got?.[0]?.promptId).toBe("turn-old")
  })

  it("定时主动轮的原生前缀剥掉后仍严格关联宿主轮次", () => {
    const got = grokHookItems("_x.ai/session_notification", notification([
      { name: "cron-hook", status: { status: "failed", error: "late", blocked: false } },
    ], { prompt_id: "scheduler-fired-host-turn" }))
    expect(got?.[0]?.promptId).toBe("host-turn")
  })

  it("原生 prompt 元数据只携带宿主轮次关联标识", () => {
    expect(grokPromptMeta("turn-7")).toEqual({ promptId: "turn-7" })
  })
})
