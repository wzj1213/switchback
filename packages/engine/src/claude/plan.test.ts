import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createPlanState, emitPlan, feedPlan, isPlanTool, resetPlan } from "./plan.js"

const create = (subject: string): unknown => ({
  type: "tool_use",
  name: "TaskCreate",
  input: { subject, description: "…", activeForm: "正在…" },
})
const update = (taskId: string, status: string): unknown => ({
  type: "tool_use",
  name: "TaskUpdate",
  input: { taskId, status },
})

function out() {
  const events: Event[] = []
  let n = 0
  return {
    events,
    sink: { threadId: "t1", emit: (e: Event) => events.push(e), nextId: () => `pl-${String((n += 1))}` },
  }
}
const steps = (events: Event[]) =>
  events.filter((e) => e.type === "item.started" || e.type === "item.updated").at(-1)?.item

describe("claude 的待办清单 → plan item", () => {
  it("**实测的形状**：TaskCreate 带 subject，按创建顺序发号", () => {
    const s = createPlanState()
    expect(feedPlan(s, create("读 a.txt"))).toBe(true)
    expect(feedPlan(s, create("读 b.txt"))).toBe(true)
    const o = out()
    emitPlan(s, "tn", 1, o.sink)
    expect(steps(o.events)).toMatchObject({
      kind: "plan",
      steps: [
        { text: "读 a.txt", status: "pending" },
        { text: "读 b.txt", status: "pending" },
      ],
    })
  })

  it("TaskUpdate 按 id 改状态——**id 就是创建序**，不靠正则抠那句英文", () => {
    const s = createPlanState()
    feedPlan(s, create("一"))
    feedPlan(s, create("二"))
    expect(feedPlan(s, update("2", "in_progress"))).toBe(true)
    const o = out()
    emitPlan(s, "tn", 1, o.sink)
    expect((steps(o.events) as unknown as { steps: { status: string }[] }).steps.map((x) => x.status)).toEqual([
      "pending",
      "in_progress",
    ])
  })

  it("**认不出的 id 丢掉，不凭空建一条**——一条内容是 id 的步骤，读的人只会以为自己记错了", () => {
    const s = createPlanState()
    feedPlan(s, create("一"))
    expect(feedPlan(s, update("99", "completed"))).toBe(false)
    expect(s.steps.size).toBe(1)
  })

  it("**状态认不出时当 pending**——猜错的方向必须是「还没做」，不能是「做完了」", () => {
    const s = createPlanState()
    feedPlan(s, create("一"))
    feedPlan(s, update("1", "某种新状态"))
    expect([...s.steps.values()][0]?.status).toBe("pending")
    feedPlan(s, update("1", "completed"))
    expect([...s.steps.values()][0]?.status).toBe("done")
  })

  it("**复用同一个 item id**：同一份计划在变，不是每改一步多一张卡", () => {
    const s = createPlanState()
    feedPlan(s, create("一"))
    const o = out()
    emitPlan(s, "tn", 1, o.sink)
    feedPlan(s, update("1", "in_progress"))
    emitPlan(s, "tn", 2, o.sink)
    expect(o.events.map((e) => e.type)).toEqual(["item.started", "item.updated"])
    expect(new Set(o.events.map((e) => (e as unknown as { item: { id: string } }).item.id)).size).toBe(1)
  })

  it("一条都没有时不发空卡", () => {
    const o = out()
    emitPlan(createPlanState(), "tn", 1, o.sink)
    expect(o.events).toEqual([])
  })

  it("轮次收工要重置——下一轮是新的一份计划，不该接着上一轮画", () => {
    const s = createPlanState()
    feedPlan(s, create("一"))
    emitPlan(s, "tn", 1, out().sink)
    resetPlan(s)
    expect(s.steps.size).toBe(0)
    expect(s.itemId).toBeUndefined()
  })

  it("**认出待办工具就不画成工具行**——计划卡已经在说同一件事", () => {
    expect(isPlanTool(create("x"))).toBe(true)
    expect(isPlanTool(update("1", "done"))).toBe(true)
    expect(isPlanTool({ type: "tool_use", name: "TaskList", input: {} })).toBe(true)
    expect(isPlanTool({ type: "tool_use", name: "Read", input: {} })).toBe(false)
    expect(isPlanTool({ type: "text", text: "hi" })).toBe(false)
    expect(isPlanTool(undefined)).toBe(false)
  })
})
