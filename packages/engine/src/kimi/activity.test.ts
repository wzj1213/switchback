import type { Event } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { KimiActivityTracker } from "./activity.js"
import type { KimiSnapshot, KimiSubagent } from "./wire.js"

function tracker(): { activity: KimiActivityTracker; events: Event[] } {
  const events: Event[] = []
  return {
    events,
    activity: new KimiActivityTracker({ threadId: "th-1", emit: (event) => events.push(event) }),
  }
}

function laneOf(events: readonly Event[]) {
  return events.filter((event) => event.type === "lane.updated").at(-1)?.lane
}

function snapshot(subagents: readonly KimiSubagent[]): KimiSnapshot {
  return {
    as_of_seq: 9,
    epoch: "ep-1",
    session: { id: "s-1", title: "", busy: false, metadata: { cwd: "/work" }, agent_config: {} },
    in_flight_turn: null,
    pending_approvals: [],
    pending_questions: [],
    subagents,
  }
}

describe("Kimi 原生活动", () => {
  it("按生产帧把出生、运行和原生总结收进同一条稳定 lane", () => {
    const out = tracker()
    out.activity.handle({
      type: "subagent.spawned",
      subagentId: "agent-2",
      subagentName: "explore",
      description: "列出当前目录内容",
    }, 10)
    out.activity.handle({ type: "subagent.started", subagentId: "agent-2" }, 11)
    out.activity.handle({
      type: "subagent.completed",
      subagentId: "agent-2",
      resultSummary: "目录为空",
    }, 20)

    expect(laneOf(out.events)).toEqual({
      id: "kimi-subagent-agent-2",
      threadId: "th-1",
      kind: "activity",
      title: "列出当前目录内容",
      status: "done",
      at: 10,
      handle: "agent-2",
      summary: "目录为空",
    })
  })

  it("后台进程的新旧双帧按 task id 去重，终态保留原生失败原因", () => {
    const out = tracker()
    const started = {
      taskId: "bash-1", description: "生成索引", status: "running", kind: "process", startedAt: 10,
    }
    out.activity.handle({ type: "task.started", info: started }, 10)
    out.activity.handle({ type: "background.task.started", info: started }, 10)
    const ended = { ...started, status: "failed", stopReason: "timeout" }
    out.activity.handle({ type: "task.terminated", info: ended }, 20)
    out.activity.handle({ type: "background.task.terminated", info: ended }, 20)

    expect(out.events).toHaveLength(2)
    expect(laneOf(out.events)).toMatchObject({
      id: "kimi-task-bash-1", title: "生成索引", status: "failed", at: 10,
      handle: "bash-1", summary: "timeout",
    })
  })

  it("后台任务收下引擎自报的命令原文与输出末尾；重连读回不带输出也不抹掉结论", () => {
    const out = tracker()
    const info = {
      taskId: "bash-a13", description: "跑 OrderBatchServiceTest 单测", status: "running",
      detached: true, startedAt: 10, kind: "process", command: "mvn -o -B test -Dtest=X", pid: 4816,
      exitCode: null,
    }
    out.activity.handle({ type: "task.started", info }, 10)
    expect(laneOf(out.events)).toMatchObject({ command: "mvn -o -B test -Dtest=X", at: 10 })
    expect(laneOf(out.events)?.summary).toBeUndefined()

    // 生产 wire 里 `outputTail` 是 `info` 的兄弟字段，不在它里面
    out.activity.handle({
      type: "task.terminated",
      info: { ...info, status: "completed", endedAt: 20, exitCode: 0 },
      outputTail: "[INFO] BUILD SUCCESS",
    }, 20)
    expect(laneOf(out.events)).toMatchObject({
      status: "done", command: "mvn -o -B test -Dtest=X", summary: "[INFO] BUILD SUCCESS",
    })

    // 重连读回：REST 快照这次既没有 command 也没有 output_preview
    const seen = out.events.length
    out.activity.reconcile(snapshot([]), 99, [
      { id: "bash-a13", session_id: "s-1", kind: "bash", description: "跑 OrderBatchServiceTest 单测",
        status: "completed", created_at: 10 },
    ])
    expect(out.events).toHaveLength(seen)
    expect(laneOf(out.events)).toMatchObject({
      command: "mvn -o -B test -Dtest=X", summary: "[INFO] BUILD SUCCESS",
    })
  })

  it("失败的后台任务把原生原因排在输出前面", () => {
    const out = tracker()
    const info = { taskId: "bash-x", description: "打包", status: "running", startedAt: 1, kind: "process" }
    out.activity.handle({ type: "task.started", info }, 1)
    out.activity.handle({
      type: "task.terminated",
      info: { ...info, status: "timed_out", stopReason: "timeout" },
      outputTail: "[ERROR] 卡在依赖解析",
    }, 2)
    expect(laneOf(out.events)).toMatchObject({ status: "failed", summary: "timeout" })
  })

  it("任务读回只补 process/bash；agent 与 question 仍分别归子代理和问题卡", () => {
    const out = tracker()
    out.activity.reconcile(snapshot([]), 99, [
      {
        id: "bash-2", session_id: "s-1", kind: "bash", description: "后台检查",
        status: "completed", created_at: "2026-08-25T06:23:42.113Z",
      },
      {
        id: "agent-1", session_id: "s-1", kind: "subagent", description: "代理",
        status: "running", created_at: 1,
      },
      {
        id: "question-1", session_id: "s-1", kind: "tool", description: "问题",
        status: "running", created_at: 1,
      },
    ])

    expect(out.events).toHaveLength(1)
    expect(laneOf(out.events)).toMatchObject({ id: "kimi-task-bash-2", status: "done", title: "后台检查" })
  })

  it("保留暂停原因与失败原文，迟到的运行帧不能把终态改回转圈", () => {
    const out = tracker()
    expect(out.activity.handle({ type: "subagent.started", subagentId: "missing" }, 1)).toBe(true)
    expect(out.events).toEqual([])
    out.activity.handle({ type: "subagent.spawned", subagentId: "a", description: "核对配置" }, 2)
    out.activity.handle({ type: "subagent.suspended", subagentId: "a", reason: "等待依赖" }, 3)
    expect(laneOf(out.events)?.status).toBe("paused")
    expect(laneOf(out.events)?.progress?.nodes[0]).toMatchObject({ detail: "等待依赖", state: "running" })
    out.activity.handle({ type: "subagent.failed", subagentId: "a", error: "worker crashed" }, 4)
    out.activity.handle({ type: "subagent.started", subagentId: "a" }, 5)
    expect(laneOf(out.events)).toMatchObject({ status: "failed", summary: "worker crashed", at: 2 })
    expect(laneOf(out.events)?.progress).toBeUndefined()
  })

  it("启动与重连从快照补回实时漏掉的完成态，只认真正的 subagent", () => {
    const out = tracker()
    const rows: readonly KimiSubagent[] = [
      {
        id: "agent-3",
        session_id: "s-1",
        kind: "subagent",
        description: "确认当前路径",
        status: "completed",
        subagent_phase: "completed",
        created_at: "2026-08-25T05:49:29.708Z",
        output_preview: "/tmp/audit",
      },
      { id: "shell-1", session_id: "s-1", kind: "bash", description: "sleep 1", status: "running" },
    ]
    out.activity.reconcile(snapshot(rows), 99)

    expect(out.events).toHaveLength(1)
    expect(laneOf(out.events)).toMatchObject({
      title: "确认当前路径",
      status: "done",
      at: new Date("2026-08-25T05:49:29.708Z").getTime(),
      summary: "/tmp/audit",
    })
  })
})
