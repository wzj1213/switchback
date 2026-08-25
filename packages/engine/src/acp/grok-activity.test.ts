import { describe, expect, it } from "vitest"
import { createGrokActivity } from "./grok-activity.js"

const params = (update: unknown): unknown => ({ sessionId: "s", update })

describe("grok 的后台任务生命周期", () => {
  it("开始帧优先用人话描述，完成帧更新同一张卡", () => {
    const activity = createGrokActivity()
    expect(
      activity("_x.ai/task_backgrounded", params({
        sessionUpdate: "task_backgrounded", task_id: "bg-1", command: "sleep 1", description: "等待服务启动",
      })),
    ).toEqual({ id: "grok-task-bg-1", title: "等待服务启动", status: "running", handle: "bg-1" })
    expect(
      activity("_x.ai/task_completed", params({
        sessionUpdate: "task_completed", task_snapshot: { task_id: "bg-1", exit_code: 0, signal: null },
      })),
    ).toEqual({ id: "grok-task-bg-1", title: "等待服务启动", status: "done", handle: "bg-1" })
  })

  it("失败保留退出码或信号", () => {
    const activity = createGrokActivity()
    expect(
      activity("_x.ai/task_completed", params({
        sessionUpdate: "task_completed",
        task_snapshot: { task_id: "bg-2", command: "false", exit_code: 7, signal: null },
      })),
    ).toMatchObject({ id: "grok-task-bg-2", status: "failed", summary: "exit code 7" })
    expect(
      activity("_x.ai/task_completed", params({
        sessionUpdate: "task_completed",
        task_snapshot: { task_id: "bg-3", command: "wait", exit_code: null, signal: "SIGTERM" },
      })),
    ).toMatchObject({ id: "grok-task-bg-3", status: "failed", summary: "SIGTERM" })
  })

  it("冷加载清理旧进程不冒充本次新失败，畸形或别路通知保持安静", () => {
    const activity = createGrokActivity()
    const stale = {
      sessionUpdate: "task_completed",
      task_snapshot: { task_id: "old", command: "sleep", exit_code: null, signal: "session_restart" },
    }
    expect(activity("_x.ai/task_completed", params(stale))).toBeUndefined()
    expect(activity("_x.ai/task_completed", params({ sessionUpdate: "task_completed" }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", params(stale))).toBeUndefined()
  })

  it("监控事件追加到原生工具卡，直达与 leader 包装形状都能认", () => {
    const activity = createGrokActivity()
    activity("_x.ai/task_backgrounded", params({
      sessionUpdate: "task_backgrounded", task_id: "mon-1", tool_call_id: "call-1",
      command: "tail -f app.log", monitor_description: "观察应用日志",
    }))
    expect(activity("_x.ai/monitor_event", params({
      sessionUpdate: "monitor_event", task_id: "mon-1", event_text: "first line",
    }))).toEqual({ itemId: "call-1", append: "first line\n" })
    expect(activity("_x.ai/monitor_event", {
      method: "x.ai/monitor_event",
      params: params({ sessionUpdate: "monitor_event", task_id: "mon-1", event_text: "second line\n" }),
    })).toEqual({ itemId: "call-1", append: "second line\n" })
  })

  it("未知任务与畸形监控帧保持安静，普通活动也兼容 leader 包装", () => {
    const activity = createGrokActivity()
    expect(activity("_x.ai/monitor_event", params({
      sessionUpdate: "monitor_event", task_id: "unknown", event_text: "orphan",
    }))).toBeUndefined()
    expect(activity("_x.ai/monitor_event", params({
      sessionUpdate: "monitor_event", task_id: "unknown", event_text: " ",
    }))).toBeUndefined()
    expect(activity("_x.ai/task_backgrounded", {
      method: "x.ai/task_backgrounded",
      params: params({ sessionUpdate: "task_backgrounded", task_id: "wrapped", description: "包装任务" }),
    })).toMatchObject({ id: "grok-task-wrapped", title: "包装任务", status: "running" })
  })
})

describe("grok 的原生子代理生命周期", () => {
  it("父会话首帧建立卡片，进度保留标题与原生 token 预算", () => {
    const activity = createGrokActivity()
    expect(
      activity("_x.ai/session_notification", params({
        sessionUpdate: "subagent_spawned", child_session_id: "child-1", subagent_id: "child-1",
        subagent_type: "explore", description: "盘点认证入口",
      })),
    ).toEqual({ id: "grok-subagent-child-1", title: "盘点认证入口", status: "running", handle: "child-1" })
    expect(
      activity("_x.ai/session_notification", params({
        sessionUpdate: "subagent_progress", child_session_id: "child-1",
        tokens_used: 1234, context_window_tokens: 131072,
      })),
    ).toEqual({
      id: "grok-subagent-child-1", title: "盘点认证入口", status: "running", handle: "child-1",
      progress: { nodes: [], budget: { used: 1234, total: 131072 } },
    })
  })

  it("完成保留原生输出，失败保留原生错误，终态不被迟到进度复活", () => {
    const activity = createGrokActivity()
    const spawn = (id: string, title: string) => activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_spawned", child_session_id: id, description: title,
    }))
    spawn("done", "复核接口")
    expect(activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_finished", child_session_id: "done", status: "completed", output: "全部通过。",
    }))).toMatchObject({ id: "grok-subagent-done", status: "done", summary: "全部通过。" })
    expect(activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_progress", child_session_id: "done", tokens_used: 9, context_window_tokens: 10,
    }))).toBeUndefined()

    spawn("bad", "检查构建")
    expect(activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_finished", child_session_id: "bad", status: "failed", error: "build failed",
    }))).toMatchObject({ id: "grok-subagent-bad", status: "failed", summary: "build failed" })
  })

  it("工作流子代理交给工作流总卡，缺首帧与畸形状态不编造活动", () => {
    const activity = createGrokActivity()
    expect(activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_spawned", child_session_id: "wf-child", description: "阶段一", workflow_run_id: "wf-1",
    }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_finished", child_session_id: "wf-child", status: "completed", output: "ok",
    }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", params({
      sessionUpdate: "subagent_progress", child_session_id: "orphan", tokens_used: 1,
    }))).toBeUndefined()
  })

  it("不同原生会话的首帧状态不会串用", () => {
    const first = createGrokActivity()
    const second = createGrokActivity()
    first("_x.ai/session_notification", params({
      sessionUpdate: "subagent_spawned", child_session_id: "same-id", description: "只属于第一条会话",
    }))
    expect(second("_x.ai/session_notification", params({
      sessionUpdate: "subagent_progress", child_session_id: "same-id", tokens_used: 1,
    }))).toBeUndefined()
  })
})

const workflow = (patch: Record<string, unknown> = {}): unknown => params({
  sessionUpdate: "workflow_updated",
  run_id: "wf-1",
  revision: 1,
  name: "deep-research",
  objective: "核对三家认证链路",
  status: "active",
  phases: [
    { title: "检索", state: "done" },
    { title: "验证", state: "active" },
  ],
  agents: [
    { agent_id: "a-1", label: "查源码", phase: "检索", model: "grok-4.6", state: "done", tokens_used: 1200 },
    { agent_id: "a-2", label: "跑生产", phase: "验证", state: "running", tokens_used: 900 },
  ],
  agents_used: 2,
  agent_budget: 4,
  ...patch,
})

describe("grok 的原生 workflow 快照", () => {
  it("全量阶段、代理层级与原生预算进入同一张活动卡", () => {
    const activity = createGrokActivity()
    expect(activity("_x.ai/session_notification", workflow())).toEqual({
      id: "grok-workflow-wf-1", title: "核对三家认证链路", status: "running", handle: "wf-1",
      progress: {
        budget: { used: 2, total: 4 },
        nodes: [
          { id: "phase-0", label: "检索", state: "done" },
          { id: "phase-1", label: "验证", state: "running" },
          { id: "agent-a-1", label: "查源码", state: "done", parent: "phase-0", detail: "grok-4.6", tokens: 1200 },
          { id: "agent-a-2", label: "跑生产", state: "running", parent: "phase-1", tokens: 900 },
        ],
      },
    })
  })

  it("暂停、完成与可恢复失败都按新 revision 更新同一张卡", () => {
    const activity = createGrokActivity()
    activity("_x.ai/session_notification", workflow())
    expect(activity("_x.ai/session_notification", workflow({
      revision: 2, status: "blocked", pause_message: "等待人工确认",
    }))).toMatchObject({ id: "grok-workflow-wf-1", status: "paused", summary: "等待人工确认" })
    expect(activity("_x.ai/session_notification", workflow({
      revision: 3, status: "failed", pause_message: "验证失败",
    }))).toMatchObject({ status: "failed", summary: "验证失败" })
    expect(activity("_x.ai/session_notification", workflow({ revision: 4, status: "active" }))).toMatchObject({
      status: "running",
    })
    expect(activity("_x.ai/session_notification", workflow({
      revision: 5, status: "complete", result_summary: "三家链路均已确认。",
    }))).toMatchObject({ status: "done", summary: "三家链路均已确认。" })
  })

  it("按 run revision 拒绝倒退、重复与 legacy 复活", () => {
    const activity = createGrokActivity()
    activity("_x.ai/session_notification", workflow({ revision: 2 }))
    expect(activity("_x.ai/session_notification", workflow({ revision: 1, status: "failed" }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", workflow({ revision: 2 }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", workflow({ revision: 0 }))).toBeUndefined()
    expect(activity("_x.ai/session_notification", workflow({ revision: 0, status: "cleared" }))).toMatchObject({
      status: "done",
    })
    expect(activity("_x.ai/session_notification", workflow({ revision: 0, status: "active" }))).toBeUndefined()
  })

  it("账目不完整时不显示精确预算，畸形节点不掀翻整张快照", () => {
    const activity = createGrokActivity()
    const lane = activity("_x.ai/session_notification", workflow({
      agent_usage_incomplete: true,
      phases: [{ title: "有效", state: "active" }, { title: 3 }],
      agents: [{ agent_id: "ok", label: "有效代理", state: "mystery" }, { agent_id: 1, label: [] }],
    }))
    const progress = lane !== undefined && "progress" in lane ? lane.progress : undefined
    expect(progress?.budget).toBeUndefined()
    expect(progress?.nodes).toEqual([
      { id: "phase-0", label: "有效", state: "running" },
      { id: "agent-ok", label: "有效代理", state: "pending" },
    ])
  })
})
