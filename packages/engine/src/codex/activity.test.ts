import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { CodexActivityTracker } from "./activity.js"

function setup(): { activity: CodexActivityTracker; events: Event[] } {
  const events: Event[] = []
  let at = 10
  return {
    events,
    activity: new CodexActivityTracker({
      threadId: "omni-thread",
      nativeThread: () => "root-thread",
      emit: (event) => events.push(event),
      now: () => at++,
    }),
  }
}

const laneOf = (events: readonly Event[]) =>
  events.findLast((event) => event.type === "lane.updated")?.lane

describe("Codex 原生子 thread 活动", () => {
  it("生产 thread/read 的 SubAgentActivity 形状变成活动卡，started/completed 重放幂等", () => {
    const { activity, events } = setup()
    const params = {
      threadId: "root-thread",
      turnId: "native-turn",
      item: {
        type: "subAgentActivity",
        id: "call_6fJCdFFUwvx6M1KY6M5vSxg6",
        kind: "started",
        agentThreadId: "child-1",
        agentPath: "/root/code_audit",
      },
    }
    expect(activity.handle("item/started", params)).toBe(true)
    expect(activity.handle("item/completed", params)).toBe(true)
    expect(events).toHaveLength(1)
    expect(laneOf(events)).toEqual({
      id: "codex-agent-child-1",
      threadId: "omni-thread",
      kind: "activity",
      title: "/root/code_audit",
      status: "running",
      at: 10,
      handle: "child-1",
    })
  })

  it("公开 thread/status 用原生忙闲与系统错误收口，不从 interacted 猜终态", () => {
    const { activity, events } = setup()
    activity.handle("item/completed", {
      threadId: "root-thread",
      item: {
        type: "subAgentActivity",
        kind: "started",
        agentThreadId: "child-1",
        agentPath: "/root/a",
      },
    })
    activity.handle("item/completed", {
      threadId: "root-thread",
      item: {
        type: "subAgentActivity",
        kind: "interacted",
        agentThreadId: "child-1",
        agentPath: "/root/a",
      },
    })
    expect(events).toHaveLength(1)
    activity.handle("thread/status/changed", { threadId: "child-1", status: { type: "idle" } })
    expect(laneOf(events)?.status).toBe("done")
    activity.handle("thread/status/changed", {
      threadId: "child-1",
      status: { type: "systemError" },
    })
    expect(laneOf(events)?.status).toBe("failed")
  })

  it("thread/started 的原生 parent/path 关系还原嵌套节点", () => {
    const { activity, events } = setup()
    activity.handle("thread/started", {
      thread: {
        id: "child-1",
        status: { type: "active", activeFlags: [] },
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "root-thread",
              depth: 1,
              agent_path: "/root/parent",
            },
          },
        },
      },
    })
    activity.handle("thread/started", {
      thread: {
        id: "child-2",
        status: { type: "active", activeFlags: [] },
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "child-1",
              depth: 2,
              agent_path: "/root/parent/check",
            },
          },
        },
      },
    })
    expect(laneOf(events)).toMatchObject({
      title: "/root/parent",
      progress: { nodes: [{ id: "child-2", label: "/root/parent/check", state: "running" }] },
    })
  })

  it("notLoaded 只登记归属，不把尚未报忙闲的 child 猜成正在运行", () => {
    const { activity, events } = setup()
    activity.handle("thread/started", {
      thread: {
        id: "child-1",
        status: { type: "notLoaded" },
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "root-thread",
              depth: 1,
              agent_path: "/root/not-loaded",
            },
          },
        },
      },
    })
    expect(events).toEqual([])
    expect(
      activity.handle("thread/status/changed", {
        threadId: "child-1",
        status: { type: "active", activeFlags: [] },
      }),
    ).toBe(true)
    expect(laneOf(events)).toMatchObject({ title: "/root/not-loaded", status: "running" })
  })

  it("别条父会话的活动和未知 child 状态不串进当前会话", () => {
    const { activity, events } = setup()
    expect(
      activity.handle("item/completed", {
        threadId: "other-root",
        item: {
          type: "subAgentActivity",
          kind: "started",
          agentThreadId: "child-x",
          agentPath: "/root/x",
        },
      }),
    ).toBe(false)
    expect(
      activity.handle("thread/status/changed", { threadId: "child-x", status: { type: "idle" } }),
    ).toBe(false)
    expect(events).toEqual([])
  })
})
