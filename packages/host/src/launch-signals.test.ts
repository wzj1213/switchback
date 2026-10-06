import { describe, expect, it } from "vitest"
import type { Thread } from "@switchback/protocol"
import { applyEarly, captureGoal, captureTitle, earlySignals } from "./launch-signals.js"

const thread: Thread = {
  id: "th-1",
  title: "目标恢复",
  cwd: "/work",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 1,
  updatedAt: 1,
  engineHistory: ["codex"],
  goal: { objective: "旧目标", status: "active", tokensUsed: 10, timeUsedSeconds: 2 },
}

describe("握手期目标快照", () => {
  it("没收到目标通知时保留旧值，明确 cleared 时才删除", () => {
    expect(applyEarly(thread, earlySignals(), 2)).toBe(thread)
    const cleared = earlySignals()
    captureGoal(cleared, undefined)
    const result = applyEarly(thread, cleared, 2)
    expect(result.goal).toBeUndefined()
    expect("goal" in result).toBe(false)
    expect(result.updatedAt).toBe(2)
  })

  it("同一握手期后到的 cleared 会覆盖先到的 updated", () => {
    const early = earlySignals()
    captureGoal(early, { objective: "新目标", status: "active", tokensUsed: 0, timeUsedSeconds: 0 })
    captureGoal(early, undefined)
    expect(applyEarly(thread, early, 3).goal).toBeUndefined()
  })
})

describe("握手期原生标题", () => {
  it("只更新自动标题，用户亲自起过的名字不动", () => {
    const early = earlySignals()
    captureTitle(early, "  引擎标题  ")
    expect(applyEarly(thread, early, 4).title).toBe("引擎标题")
    const named = { ...thread, title: "我的名字", named: true }
    expect(applyEarly(named, early, 4)).toBe(named)
  })
})
