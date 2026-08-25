import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { clearTasks, createTaskState, onTaskMessage, onTaskProgress } from "./tasks.js"

/** 实测抓到的一帧，一字不改。 */
const REAL = {
  type: "system",
  subtype: "task_progress",
  task_id: "ace84dcdfc2059d61",
  tool_use_id: "toolu_01RAQ",
  description: "Reading b.txt",
  subagent_type: "general-purpose",
  usage: { total_tokens: 13476, tool_uses: 3, duration_ms: 4186 },
  last_tool_name: "Read",
}

function out(): { events: Event[]; sink: { threadId: string; emit: (e: Event) => void } } {
  const events: Event[] = []
  return { events, sink: { threadId: "t1", emit: (e) => events.push(e) } }
}
const tasksOf = (events: Event[]) => events.filter((e) => e.type === "tasks.updated").at(-1)?.tasks
const laneOf = (events: Event[]) => events.filter((e) => e.type === "lane.updated").at(-1)?.lane

describe("子 agent 在干什么", () => {
  it("**实测的那一帧**照单翻出来", () => {
    const state = createTaskState()
    const o = out()
    onTaskProgress(state, REAL, 1, o.sink)
    expect(tasksOf(o.events)).toEqual([
      {
        id: "ace84dcdfc2059d61",
        description: "Reading b.txt",
        agentType: "general-purpose",
        lastTool: "Read",
        toolUses: 3,
        ms: 4186,
      },
    ])
  })

  it("**整份替换**，不是增量——增量要再发明一种删除事件，漏发一次就留一条永远在跑的", () => {
    const state = createTaskState()
    const o = out()
    onTaskProgress(state, { ...REAL, task_id: "a", description: "读 a" }, 1, o.sink)
    onTaskProgress(state, { ...REAL, task_id: "b", description: "读 b" }, 2, o.sink)
    expect(tasksOf(o.events)?.map((t) => t.description)).toEqual(["读 a", "读 b"])
  })

  it("同一个任务后到的覆盖先到的", () => {
    const state = createTaskState()
    const o = out()
    onTaskProgress(state, { ...REAL, description: "第一步" }, 1, o.sink)
    onTaskProgress(state, { ...REAL, description: "第二步" }, 2, o.sink)
    expect(tasksOf(o.events)).toHaveLength(1)
    expect(tasksOf(o.events)?.[0]?.description).toBe("第二步")
  })

  it("**没有 description 就整条不要**——拿工具名拼一句顶替，是 omni 在替引擎说话", () => {
    const state = createTaskState()
    const o = out()
    onTaskProgress(state, { task_id: "x", last_tool_name: "Read" }, 1, o.sink)
    expect(o.events).toEqual([])
  })

  it("认不出的形状不崩、也不产出——协议一直在加新字段", () => {
    const state = createTaskState()
    const o = out()
    expect(() => {
      onTaskProgress(state, undefined, 1, o.sink)
      onTaskProgress(state, { task_id: 42, description: [] }, 1, o.sink)
    }).not.toThrow()
    expect(o.events).toEqual([])
  })

  it("收工要报一次空的——不报的话界面上那几条会一直挂着", () => {
    const state = createTaskState()
    const o = out()
    onTaskProgress(state, REAL, 1, o.sink)
    clearTasks(state, 2, o.sink)
    expect(tasksOf(o.events)).toEqual([])
  })

  it("本来就没有任务时收工不发多余的事件", () => {
    const o = out()
    clearTasks(createTaskState(), 1, o.sink)
    expect(o.events).toEqual([])
  })

  it("started 先立一条稳定标题的 lane，不拿缺席的 usage 伪造活动读数", () => {
    const o = out()
    onTaskMessage(createTaskState(), {
      type: "system", subtype: "task_started", task_id: "w1", description: "并行检查两份文件",
    }, 7, o.sink)
    expect(tasksOf(o.events)).toBeUndefined()
    expect(laneOf(o.events)).toEqual({
      id: "w1", threadId: "t1", kind: "activity", title: "并行检查两份文件",
      status: "running", at: 7, handle: "w1",
    })
  })

  it("skip_transcript 的宿主杂务不塞回内联转录区，后续进度与通知也保持隐藏", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "ambient", description: "housekeeping",
      skip_transcript: true,
    }, 1, o.sink)
    onTaskMessage(state, { ...REAL, task_id: "ambient" }, 2, o.sink)
    onTaskMessage(state, {
      type: "system", subtype: "task_notification", task_id: "ambient", status: "completed",
      summary: "housekeeping completed", skip_transcript: true,
    }, 3, o.sink)
    expect(o.events).toEqual([])
  })

  it("心跳帧不带 workflow_progress 时保住最近一棵树，started 标题也不跟当前 agent 跳", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "w1", description: "并行检查两份文件",
    }, 1, o.sink)
    onTaskMessage(state, {
      ...REAL,
      task_id: "w1",
      workflow_progress: [
        { type: "workflow_phase", index: 1, title: "检查" },
        { type: "workflow_agent", index: 1, label: "a.txt", phaseIndex: 1, state: "running" },
      ],
    }, 2, o.sink)
    const tree = laneOf(o.events)?.progress
    onTaskMessage(state, { ...REAL, task_id: "w1", description: "Reading b.txt" }, 3, o.sink)
    expect(laneOf(o.events)).toMatchObject({ title: "并行检查两份文件", at: 1, progress: tree })
  })

  it("notification 给 lane 权威终态、原生总结和 token 用量，同时撤掉活动行", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "w1", description: "并行检查两份文件",
    }, 1, o.sink)
    onTaskMessage(state, { ...REAL, task_id: "w1" }, 2, o.sink)
    onTaskMessage(state, {
      type: "system", subtype: "task_notification", task_id: "w1", status: "completed",
      summary: "Dynamic workflow completed", usage: { total_tokens: 22683 },
    }, 3, o.sink)
    expect(tasksOf(o.events)).toEqual([])
    expect(laneOf(o.events)).toMatchObject({
      title: "并行检查两份文件", status: "done", at: 1,
      summary: "Dynamic workflow completed", progress: { budget: { used: 22683 } },
    })
  })

  it.each(["failed", "stopped"] as const)("notification 的 %s 都是失败终态", (status) => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "w1", description: "检查",
    }, 1, o.sink)
    onTaskMessage(state, {
      type: "system", subtype: "task_notification", task_id: "w1", status, summary: `${status} natively`,
    }, 2, o.sink)
    expect(laneOf(o.events)).toMatchObject({ status: "failed", summary: `${status} natively` })
  })

  it("原生 paused 停住活动环，不冒充仍在运行或已经失败", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "w1", description: "等待外部评审",
    }, 1, o.sink)
    onTaskMessage(state, {
      type: "system", subtype: "task_updated", task_id: "w1", patch: { status: "paused" },
    }, 2, o.sink)
    expect(laneOf(o.events)).toMatchObject({ status: "paused", title: "等待外部评审" })
  })

  it("updated 合并描述和终态补丁，保住进度快照；迟到的 progress 不会把它复活", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "w1", description: "初始标题",
    }, 1, o.sink)
    onTaskMessage(state, {
      ...REAL,
      task_id: "w1",
      workflow_progress: [{ type: "workflow_agent", index: 1, label: "读文件", state: "running" }],
    }, 2, o.sink)
    const progress = laneOf(o.events)?.progress
    onTaskMessage(state, {
      type: "system", subtype: "task_updated", task_id: "w1",
      patch: { description: "最终标题", status: "completed" },
    }, 3, o.sink)
    const settled = laneOf(o.events)
    onTaskMessage(state, { ...REAL, task_id: "w1", description: "迟到心跳" }, 4, o.sink)
    expect(tasksOf(o.events)).toEqual([])
    expect(laneOf(o.events)).toEqual(settled)
    expect(settled).toMatchObject({ title: "最终标题", status: "done", progress })
  })

  it("workflow 最后一棵树已全结束时就撤活动行，不依赖下一条 edge 一定送达", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      ...REAL,
      task_id: "w1",
      workflow_progress: [{ type: "workflow_agent", index: 1, label: "读文件", state: "done" }],
    }, 1, o.sink)
    expect(laneOf(o.events)).toMatchObject({ status: "done" })
    expect(tasksOf(o.events)).toEqual([])
  })

  it("updated 的原生错误先成为失败总结，notification 到达后再以最终总结收口", () => {
    const state = createTaskState()
    const o = out()
    onTaskMessage(state, {
      type: "system", subtype: "task_started", task_id: "w1", description: "检查",
    }, 1, o.sink)
    onTaskMessage(state, {
      type: "system", subtype: "task_updated", task_id: "w1",
      patch: { status: "failed", error: "worker crashed" },
    }, 2, o.sink)
    expect(laneOf(o.events)).toMatchObject({ status: "failed", summary: "worker crashed" })
    onTaskMessage(state, {
      type: "system", subtype: "task_notification", task_id: "w1", status: "failed",
      summary: "Task failed after 2 seconds",
    }, 3, o.sink)
    expect(laneOf(o.events)).toMatchObject({ status: "failed", summary: "Task failed after 2 seconds" })
  })
})
