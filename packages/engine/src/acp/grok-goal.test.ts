import { describe, expect, it } from "vitest"
import type { ForeignActivity, ForeignActivityUpdate } from "./caps.js"
import { createGrokActivity } from "./grok-activity.js"

const laneOf = (value: ForeignActivityUpdate | undefined): ForeignActivity | undefined =>
  value === undefined || "itemId" in value ? undefined : value

const goal = (patch: Record<string, unknown> = {}): unknown => ({
  sessionId: "s",
  update: {
    sessionUpdate: "goal_updated",
    goal_id: "goal-1",
    objective: "把认证链路完整走通",
    status: "active",
    phase: "executing",
    token_budget: 50000,
    tokens_used: 12300,
    current_subagent_role: "Worker",
    live_subagent_tokens: 8200,
    live_tokens_by_model: [["grok-4.6", 5000], ["grok-4.6-fast", 3200]],
    live_context_pct: 34,
    live_turn_count: 5,
    live_tool_call_count: 12,
    last_event: "worker_started",
    last_event_detail: "round 3",
    ...patch,
  },
})

describe("grok 的原生 goal 进度", () => {
  it("保留已确认 token 下界，并把当前子代理与多模型拆分放进节点", () => {
    const activity = createGrokActivity()
    expect(activity("_x.ai/session_notification", goal())).toEqual({
      id: "grok-goal-goal-1", title: "把认证链路完整走通", status: "running", handle: "goal-1",
      progress: {
        budget: { used: 12300, total: 50000 },
        nodes: [
          { id: "phase", label: "Executing", state: "running", detail: "round 3" },
          {
            id: "subagent", label: "Worker", parent: "phase", state: "running", tokens: 8200,
            detail: "Context 34% · 5 turns · 12 tools",
          },
          { id: "model-0", label: "grok-4.6", parent: "subagent", state: "running", tokens: 5000 },
          { id: "model-1", label: "grok-4.6-fast", parent: "subagent", state: "running", tokens: 3200 },
        ],
      },
    })
  })

  it("验证与规划瞬态优先于稳态 phase", () => {
    const verifying = laneOf(createGrokActivity()("_x.ai/session_notification", goal({ verifying_completion: true })))
    const planning = laneOf(createGrokActivity()("_x.ai/session_notification", goal({ planning: true })))
    expect(verifying?.progress?.nodes[0]?.label).toBe("Verifying")
    expect(planning?.progress?.nodes[0]?.label).toBe("Planning")
  })

  it.each([
    ["user_paused", "paused"],
    ["back_off_paused", "paused"],
    ["no_progress_paused", "paused"],
    ["infra_paused", "paused"],
    ["blocked", "paused"],
    ["budget_limited", "paused"],
    ["future_paused", "paused"],
    ["failed", "failed"],
    ["interrupted", "failed"],
    ["complete", "done"],
  ] as const)("原生 %s 映射为 %s", (native, expected) => {
    const lane = laneOf(createGrokActivity()("_x.ai/session_notification", goal({
      status: native, pause_message: native === "blocked" ? "缺少生产凭证" : undefined,
    })))
    expect(lane?.status).toBe(expected)
    if (native === "blocked") expect(lane?.summary).toBe("缺少生产凭证")
  })

  it("失败可按后续原生帧恢复；完成与 cleared 不被迟到运行帧复活", () => {
    const failed = createGrokActivity()
    failed("_x.ai/session_notification", goal({ status: "failed" }))
    expect(laneOf(failed("_x.ai/session_notification", goal({ status: "active" })))?.status).toBe("running")

    const complete = createGrokActivity()
    complete("_x.ai/session_notification", goal({ status: "complete" }))
    expect(complete("_x.ai/session_notification", goal({ status: "active" }))).toBeUndefined()

    const cleared = createGrokActivity()
    expect(cleared("_x.ai/session_notification", goal({ status: "cleared" }))).toBeUndefined()
    cleared("_x.ai/session_notification", goal())
    expect(cleared("_x.ai/session_notification", goal({ status: "cleared" }))).toMatchObject({ status: "done" })
    expect(cleared("_x.ai/session_notification", goal({ status: "active" }))).toBeUndefined()
  })

  it("缺身份、目标或错误方法时不编一张 goal 卡", () => {
    const activity = createGrokActivity()
    expect(activity("_x.ai/session_notification", goal({ goal_id: undefined }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", goal({ objective: undefined }))).toBeUndefined()
    expect(activity("session/update", goal())).toBeUndefined()
  })
})
