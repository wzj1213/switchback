import { describe, expect, it } from "vitest"
import type { Item, PlanItem, PlanStep } from "@omni/protocol"
import { latestPlan, openPlan, stepProgressOf, visibleSteps } from "./plan.js"

const plan = (id: string, steps: readonly PlanStep[]): PlanItem => ({
  id,
  turnId: "turn-1",
  kind: "plan",
  at: 0,
  steps,
})

const step = (text: string, status: PlanStep["status"]): PlanStep => ({ text, status })

describe("plan selectors", () => {
  it("最后一份计划覆盖旧计划，空计划会明确清空", () => {
    const items = [
      plan("old", [step("旧任务", "pending")]),
      { id: "m", turnId: "turn-1", kind: "agent_message", at: 0, text: "继续", complete: true },
      plan("clear", []),
    ] satisfies readonly Item[]
    expect(latestPlan(items)?.id).toBe("clear")
    expect(openPlan(items)).toBeUndefined()
  })

  it("跨轮保留最后一份仍未完成的计划", () => {
    const current = plan("current", [step("完成", "done"), step("继续", "pending")])
    expect(
      openPlan([
        current,
        { id: "m", turnId: "turn-2", kind: "agent_message", at: 0, text: "好", complete: true },
      ]),
    ).toBe(current)
    expect(
      openPlan([plan("done", [step("完成", "done"), step("取消", "dropped")])]),
    ).toBeUndefined()
  })

  it.each([
    [
      "有当前步",
      [step("a", "done"), step("b", "in_progress"), step("c", "pending")],
      { index: 2, total: 3, done: 1, complete: false },
    ],
    [
      "尚未开始",
      [step("a", "pending"), step("b", "pending")],
      { total: 2, done: 0, complete: false },
    ],
    [
      "步间空档",
      [step("a", "done"), step("b", "pending")],
      { index: 2, total: 2, done: 1, complete: false },
    ],
    [
      "全部完成",
      [step("a", "done"), step("b", "dropped")],
      { index: 1, total: 1, done: 1, complete: true },
    ],
    ["没有有效步骤", [step("a", "dropped")], { total: 0, done: 0, complete: true }],
  ] as const)("进度：%s", (_name, steps, expected) => {
    expect(stepProgressOf(steps)).toEqual(expected)
  })

  it("长计划露出当前、下一步与最近完成项，并保持原顺序", () => {
    const steps = [
      step("done-1", "done"),
      step("done-2", "done"),
      step("done-3", "done"),
      step("done-4", "done"),
      step("done-5", "done"),
      step("active", "in_progress"),
      step("next-1", "pending"),
      step("next-2", "pending"),
      step("next-3", "pending"),
    ]
    expect(visibleSteps(steps, 4).map((item) => item.text)).toEqual([
      "done-5",
      "active",
      "next-1",
      "next-2",
    ])
  })
})
