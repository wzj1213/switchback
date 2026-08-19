import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { clearTasks, createTaskState, onTaskProgress } from "./tasks.js"

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
})
