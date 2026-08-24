import { describe, expect, it } from "vitest"
import { toLane } from "./workflow.js"

/** 2026-08-19 真机抓到的那一帧，原样。原文也贴在 `tasks.ts` 的头注释里。 */
const REAL = {
  subtype: "task_progress",
  task_id: "w4zk4icbn",
  description: "Read: read:alpha.txt",
  last_tool_name: "read:alpha.txt",
  workflow_progress: [
    { type: "workflow_phase", index: 1, title: "Read" },
    {
      type: "workflow_agent", index: 1, label: "read:alpha.txt",
      phaseIndex: 1, phaseTitle: "Read", agentId: "a5403b31", state: "done",
      tokens: 11031, toolCalls: 2, durationMs: 4673,
      lastToolName: "StructuredOutput", lastToolSummary: "红",
    },
  ],
}

describe("workflow 进度 → 一条 lane", () => {
  it("**实测那一帧**：一个 workflow 一条 lane，阶段与 agent 是同一张扁平表", () => {
    const lane = toLane(REAL, "th-1", 7)
    expect(lane).toMatchObject({ id: "w4zk4icbn", threadId: "th-1", kind: "activity", handle: "w4zk4icbn" })
    expect(lane?.progress?.nodes).toEqual([
      { id: "p1", label: "Read", state: "done" },
      { id: "a1", label: "read:alpha.txt", state: "done", parent: "p1", detail: "红", tokens: 11031 },
    ])
  })

  it("**阶段状态是算出来的**——`workflow_phase` 帧上没有 state 字段", () => {
    const half = { task_id: "w", description: "d", workflow_progress: [
      { type: "workflow_phase", index: 1, title: "审查" },
      { type: "workflow_agent", index: 1, phaseIndex: 1, label: "a", state: "done" },
      { type: "workflow_agent", index: 2, phaseIndex: 1, label: "b", state: "running" },
    ] }
    expect(toLane(half, "th-1", 0)?.progress?.nodes[0]).toMatchObject({ id: "p1", state: "running" })
  })

  it("有一个失败，整个阶段就是失败——不能因为大多数成功了就画成完成", () => {
    const bad = { task_id: "w", description: "d", workflow_progress: [
      { type: "workflow_phase", index: 1, title: "验证" },
      { type: "workflow_agent", index: 1, phaseIndex: 1, label: "a", state: "done" },
      { type: "workflow_agent", index: 2, phaseIndex: 1, label: "b", state: "failed" },
    ] }
    expect(toLane(bad, "th-1", 0)?.progress?.nodes[0]).toMatchObject({ state: "failed" })
    expect(toLane(bad, "th-1", 0)?.status).toBe("failed")
  })

  it("全跑完了 lane 才算完 —— `task_progress` 不报终态，只能靠节点算", () => {
    expect(toLane(REAL, "th-1", 0)?.status).toBe("done")
  })

  it("**没有 workflow_progress 就整个不报 progress**——结构性探测，不嗅 SDK 版本", () => {
    const plain = { task_id: "t1", description: "Reading b.txt", subagent_type: "general-purpose" }
    const lane = toLane(plain, "th-1", 0)
    // 造一个「单节点」的话，节点 label 和卡片标题是同一句话，同一张卡上出现两遍
    expect(lane?.progress).toBeUndefined()
    expect(lane).toMatchObject({ title: "Reading b.txt", status: "running" })
  })

  it("**`description` 缺席就整条不要**——拿工具名拼一句顶替是替引擎说话", () => {
    expect(toLane({ task_id: "t1", last_tool_name: "Read" }, "th-1", 0)).toBeUndefined()
  })

  it("认不出的形状静默丢弃，不掀翻整轮", () => {
    expect(toLane(undefined, "th-1", 0)).toBeUndefined()
    expect(toLane("字符串", "th-1", 0)).toBeUndefined()
  })

  it("**agent 先于它的 phase 到达也不掉出树**——帧顺序不由 omni 决定", () => {
    const early = { task_id: "w", description: "d", workflow_progress: [
      { type: "workflow_agent", index: 1, phaseIndex: 2, label: "先到的", state: "running" },
      { type: "workflow_phase", index: 2, title: "后到的阶段" },
    ] }
    expect(toLane(early, "th-1", 0)?.progress?.nodes).toEqual([
      { id: "p2", label: "后到的阶段", state: "running" },
      { id: "a1", label: "先到的", state: "running", parent: "p2" },
    ])
  })

  it("**tokens 为 0 不报**——那是在说「它没花钱」，而真相是这一帧没带这个数", () => {
    const zero = { task_id: "w", description: "d", workflow_progress: [
      { type: "workflow_agent", index: 1, phaseIndex: 1, label: "a", state: "running", tokens: 0 },
    ] }
    const node = toLane(zero, "th-1", 0)?.progress?.nodes.find((n) => n.id === "a1")
    expect(node && "tokens" in node).toBe(false)
  })

  it("**认不出的状态按「在跑」画**——画成 pending 会让一个正在烧钱的 agent 看起来还没开始", () => {
    const weird = { task_id: "w", description: "d", workflow_progress: [
      { type: "workflow_agent", index: 1, phaseIndex: 1, label: "a", state: "throttled" },
    ] }
    expect(toLane(weird, "th-1", 0)?.progress?.nodes.find((n) => n.id === "a1")?.state).toBe("running")
  })
})
