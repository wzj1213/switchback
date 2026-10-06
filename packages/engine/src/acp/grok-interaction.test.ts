import { describe, expect, it } from "vitest"
import type { QuestionAnswer, QuestionResponse } from "@switchback/protocol"
import { grokInteraction, grokInteractionResolved } from "./grok-interaction.js"

const PARAMS = {
  sessionId: "session-1",
  toolCallId: "tool-1",
  mode: "default",
  questions: [{
    question: "Which target?",
    options: [
      { label: "Core", description: "Inspect core", preview: "core preview" },
      { label: "TUI", description: "Inspect TUI" },
    ],
    multiSelect: false,
  }, {
    question: "Any constraints?",
    options: [],
    multi_select: false,
  }],
}

function response(answers: readonly QuestionAnswer[]): QuestionResponse {
  return {
    answers: Object.fromEntries(answers.map((answer, index) => [`tool-1:q${String(index)}`, answer])),
  }
}

describe("Grok 原生结构化问题", () => {
  it("直达、stdio 前缀直达与 leader 包装三种形状都认", () => {
    const cases = [
      ["x.ai/ask_user_question", PARAMS],
      ["_x.ai/ask_user_question", PARAMS],
      ["_x.ai/ask_user_question", { method: "x.ai/ask_user_question", params: PARAMS }],
    ] as const
    for (const [method, params] of cases) {
      expect(grokInteraction(method, params)).toMatchObject({ sessionId: "session-1", key: "tool-1" })
    }
  })

  it("保留原生题目、选项、说明、多选与自由回答入口", () => {
    expect(grokInteraction("_x.ai/ask_user_question", PARAMS)?.questions).toEqual([
      {
        id: "tool-1:q0", question: "Which target?", multiSelect: false, optional: true,
        options: [
          { id: "Core", label: "Core", description: "Inspect core", preview: "core preview" },
          { id: "TUI", label: "TUI", description: "Inspect TUI" },
        ],
        allowOther: true, otherLabel: "其他", otherDescription: "写下你的答案",
        allowNote: true, noteLabel: "补充说明（可选）", noteDescription: "可选：补充上下文",
      },
      {
        id: "tool-1:q1", question: "Any constraints?", multiSelect: false, optional: true,
        options: [], allowOther: true, otherLabel: "其他", otherDescription: "写下你的答案",
      },
    ])
  })

  it("选择、预览、备注、自由回答与跳过按 Grok 原生 accepted 形状回送", () => {
    const interaction = grokInteraction("_x.ai/ask_user_question", PARAMS)
    expect(interaction?.reply(response([
      { kind: "single", optionId: "Core", note: "focus auth" },
      { kind: "other", text: "No network" },
    ]))).toEqual({
      outcome: "accepted",
      answers: { "Which target?": ["Core"], "Any constraints?": ["Other"] },
      annotations: {
        "Which target?": { preview: "core preview", notes: "focus auth" },
        "Any constraints?": { notes: "No network" },
      },
    })
    expect(interaction?.reply(response([
      { kind: "skipped" }, { kind: "skipped" },
    ]))).toEqual({ outcome: "accepted", answers: {} })
  })

  it("关闭问题明确回 cancelled；缺身份的坏请求不认领", () => {
    expect(grokInteraction("_x.ai/ask_user_question", PARAMS)?.reply({ dismissed: true })).toEqual({
      outcome: "cancelled",
    })
    expect(grokInteraction("_x.ai/ask_user_question", { ...PARAMS, toolCallId: "" })).toBeUndefined()
  })

  it("其他客户端的原生 resolved 终态提取同一 tool id", () => {
    const direct = { sessionId: "session-1", update: {
      sessionUpdate: "interaction_resolved", tool_call_id: "tool-1",
    } }
    expect(grokInteractionResolved("_x.ai/session_notification", direct)).toBe("tool-1")
    expect(grokInteractionResolved("_x.ai/session_notification", {
      method: "x.ai/session_notification", params: direct,
    })).toBe("tool-1")
    expect(grokInteractionResolved("session/update", direct)).toBeUndefined()
  })
})

describe("Grok 退出计划模式审批", () => {
  const PLAN = {
    sessionId: "session-1", toolCallId: "plan-1", planContent: "# Plan\n\n1. Inspect README",
  }

  it("三种 gateway 形状都保留原生计划正文与三个终态", () => {
    const cases = [
      ["x.ai/exit_plan_mode", PLAN],
      ["_x.ai/exit_plan_mode", PLAN],
      ["_x.ai/exit_plan_mode", { method: "x.ai/exit_plan_mode", params: PLAN }],
    ] as const
    for (const [method, params] of cases) {
      expect(grokInteraction(method, params)).toMatchObject({
        sessionId: "session-1",
        key: "plan-1",
        questions: [{
          id: "plan-1:plan",
          header: "Grok 计划审批",
          question: "如何处理这份计划？",
          body: "# Plan\n\n1. Inspect README",
          options: [
            { id: "approved", label: "批准并执行" },
            { id: "cancelled", label: "要求修改" },
            { id: "abandoned", label: "放弃计划" },
          ],
        }],
      })
    }
  })

  it("批准、修改意见、放弃与关闭精确映射原生 outcome", () => {
    const interaction = grokInteraction("_x.ai/exit_plan_mode", PLAN)
    const answer = (optionId: string, note?: string): QuestionResponse => ({
      answers: { "plan-1:plan": { kind: "single", optionId, ...(note === undefined ? {} : { note }) } },
    })
    expect(interaction?.reply(answer("approved"))).toEqual({ outcome: "approved" })
    expect(interaction?.reply(answer("cancelled", "Add tests"))).toEqual({
      outcome: "cancelled", feedback: "Add tests",
    })
    expect(interaction?.reply(answer("abandoned"))).toEqual({ outcome: "abandoned" })
    expect(interaction?.reply({ dismissed: true })).toEqual({ outcome: "cancelled" })
  })

  it("空计划仍给明确决策卡，不让 reverse-request 卡死", () => {
    expect(grokInteraction("_x.ai/exit_plan_mode", { ...PLAN, planContent: " " })?.questions[0]?.body)
      .toBe("Grok 未提供计划正文。")
  })
})
