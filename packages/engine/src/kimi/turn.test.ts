import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { handleTurnEvent, KimiTurnTracker } from "./turn.js"
import type { KimiSnapshot } from "./wire.js"

function runningSnapshot(assistantText: string): KimiSnapshot {
  return {
    as_of_seq: 9,
    epoch: "ep",
    session: {
      id: "s1",
      title: "",
      busy: true,
      metadata: { cwd: "/work" },
      agent_config: {},
    },
    in_flight_turn: {
      turn_id: 7,
      assistant_text: assistantText,
      thinking_text: "",
      running_tools: [],
    },
    pending_approvals: [],
    pending_questions: [],
  }
}

describe("Kimi 轮次事件", () => {
  it("流式文本、命令输出和收工都落在宿主铸的同一轮上", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 99 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handleTurnEvent(tracker, { type: "thinking.delta", turnId: 7, delta: "想" }, 2)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 7, delta: "答" }, 3)
    handleTurnEvent(
      tracker,
      { type: "tool.call.started", turnId: 7, toolCallId: "tc", name: "Shell", display: { kind: "command", command: "echo ok" } },
      4,
    )
    handleTurnEvent(tracker, { type: "tool.progress", turnId: 7, toolCallId: "tc", update: { kind: "stdout", text: "o" } }, 5)
    handleTurnEvent(tracker, { type: "tool.result", turnId: 7, toolCallId: "tc", output: "ok", isError: false }, 6)
    handleTurnEvent(tracker, { type: "turn.ended", turnId: 7, reason: "completed" }, 7)

    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      { type: "turn.completed", at: 7, turnId: "omni-turn", status: "completed" },
    ])
    expect(events.filter((event) => event.type === "item.started").map((event) => event.item.kind)).toEqual([
      "reasoning",
      "agent_message",
      "tool_call",
    ])
    const tool = events.findLast((event) => event.type === "item.updated" && event.item.kind === "tool_call")
    expect(tool?.type === "item.updated" && tool.item.kind === "tool_call" ? tool.item : undefined).toMatchObject({
      id: "tc",
      status: "ok",
      detail: { kind: "shell", output: "ok" },
    })
  })

  it("不是当前原生 turn 的事件不会串进来", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "a")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "a" }, 1)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 2, delta: "别人的" }, 2)
    expect(events).toEqual([])
  })

  it("工具调用把正文切成前后两段——后续文字必须长在工具下面", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 99 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 7, delta: "工具前" }, 2)
    handleTurnEvent(
      tracker,
      { type: "tool.call.started", turnId: 7, toolCallId: "tc", name: "Shell", display: { kind: "command", command: "pwd" } },
      3,
    )
    handleTurnEvent(tracker, { type: "tool.result", turnId: 7, toolCallId: "tc", output: "ok" }, 4)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 7, delta: "工具后" }, 5)
    handleTurnEvent(tracker, { type: "turn.ended", turnId: 7, reason: "completed" }, 6)

    const started = events.flatMap((event) => (event.type === "item.started" ? [event.item] : []))
    expect(started.map((item) => item.kind)).toEqual(["agent_message", "tool_call", "agent_message"])
    expect(started.map((item) => item.id)).toEqual([
      "kimi-answer-omni-turn",
      "tc",
      "kimi-answer-omni-turn-2",
    ])
    const messages = events.flatMap((event) =>
      event.type === "item.updated" && event.item.kind === "agent_message" ? [event.item.text] : [],
    )
    expect(messages).toEqual(["工具前", "工具后"])
  })

  it("工具之后重连也只把快照新增的后缀放在工具下面", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 99 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 7, prompt: "做事" }, 1)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 7, delta: "工具前" }, 2)
    handleTurnEvent(
      tracker,
      { type: "tool.call.started", turnId: 7, toolCallId: "tc", name: "Shell", display: { kind: "command", command: "pwd" } },
      3,
    )
    tracker.reconcile(runningSnapshot("工具前工具后"))

    const started = events.flatMap((event) => (event.type === "item.started" ? [event.item] : []))
    expect(started.map((item) => item.kind)).toEqual(["agent_message", "tool_call", "agent_message"])
    expect(started[2]).toMatchObject({ text: "工具后" })
  })

  it("todo_list 原地更新成计划卡，不重复画成工具行", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "做事" }, 1)
    handleTurnEvent(
      tracker,
      {
        type: "tool.call.started",
        turnId: 1,
        toolCallId: "todo-1",
        name: "TodoWrite",
        display: { kind: "todo_list", items: [{ title: "先查", status: "in_progress" }] },
      },
      2,
    )
    handleTurnEvent(
      tracker,
      {
        type: "tool.call.started",
        turnId: 1,
        toolCallId: "todo-2",
        name: "TodoWrite",
        display: { kind: "todo_list", items: [{ title: "先查", status: "completed" }] },
      },
      3,
    )

    expect(events).toMatchObject([
      { type: "item.started", item: { id: "kimi-plan-omni-turn", kind: "plan", steps: [{ status: "in_progress" }] } },
      { type: "item.updated", item: { id: "kimi-plan-omni-turn", kind: "plan", steps: [{ status: "done" }] } },
    ])
  })

  it("同一轮多次 retry 原地更新一条提示，不重复 started", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "做事" }, 1)
    handleTurnEvent(tracker, { type: "turn.step.retrying", turnId: 1, errorMessage: "第一次" }, 2)
    handleTurnEvent(tracker, { type: "turn.step.retrying", turnId: 1, errorMessage: "第二次" }, 3)
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated"])
    expect(events[1]).toMatchObject({ item: { id: "kimi-retry-omni-turn", message: "第二次" } })
  })

  it("busy 快照尚未出现 in-flight turn 时不提前收工", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    const generation = tracker.begin("omni-turn", "做事")
    tracker.promptAccepted(generation, "prompt-1")
    const snapshot = runningSnapshot("")
    tracker.reconcile({
      ...snapshot,
      session: { ...snapshot.session, busy: true, current_prompt_id: "prompt-1" },
      in_flight_turn: null,
    })
    expect(tracker.hasActive()).toBe(true)
    expect(events).toEqual([])
  })

  it("提示词还没被 HTTP 接受时，旧的空闲快照也不能收掉新轮次", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "带图提问")
    const snapshot = runningSnapshot("")
    tracker.reconcile({
      ...snapshot,
      session: { ...snapshot.session, busy: false, last_turn_reason: "completed" },
      in_flight_turn: null,
    })
    expect(tracker.hasActive()).toBe(true)
    expect(events).toEqual([])
  })

  it("HTTP 已接受后的空闲快照能补回丢失的 turn.ended", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    const generation = tracker.begin("omni-turn", "这轮的问题")
    tracker.promptAccepted(generation, "prompt-new")
    const snapshot = runningSnapshot("")
    tracker.reconcile({
      ...snapshot,
      session: {
        ...snapshot.session,
        busy: false,
        last_turn_reason: "completed",
      },
      in_flight_turn: null,
    })
    expect(tracker.hasActive()).toBe(false)
    expect(events).toEqual([{ type: "turn.completed", at: 0, turnId: "omni-turn", status: "completed" }])
  })

  it("POST 前的外来 in-flight 快照不能抢先绑定宿主新轮次", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "这轮的新问题")
    tracker.reconcile({
      ...runningSnapshot("上一轮还在输出"),
      session: { ...runningSnapshot("").session, last_prompt: "上一轮的问题" },
    })
    expect(events).toEqual([])
    handleTurnEvent(tracker, { type: "turn.started", turnId: 8, prompt: "这轮的新问题" }, 1)
    handleTurnEvent(tracker, { type: "assistant.delta", turnId: 8, delta: "新回答" }, 2)
    expect(events).toMatchObject([{ type: "item.started", item: { text: "新回答" } }])
  })

  it("POST 后也只接 prompt id 对得上的 in-flight 快照", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    const generation = tracker.begin("omni-turn", "新问题")
    tracker.promptAccepted(generation, "prompt-new")
    const snapshot = runningSnapshot("旧回答")
    const flight = snapshot.in_flight_turn
    if (flight === null) throw new Error("测试快照必须有在途轮次")
    tracker.reconcile({
      ...snapshot,
      in_flight_turn: { ...flight, current_prompt_id: "prompt-old" },
    })
    expect(events).toEqual([])
  })

  it("旧 prompt 的 HTTP 失败迟到时，不会误杀已经接替它的新轮", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const old = tracker.begin("turn-old", "旧问题")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "旧问题" }, 1)
    handleTurnEvent(tracker, { type: "turn.ended", turnId: 1, reason: "completed" }, 2)
    tracker.begin("turn-new", "新问题")
    tracker.failGeneration(old, "旧请求断线")
    expect(tracker.hasActive()).toBe(true)
    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      { type: "turn.completed", at: 2, turnId: "turn-old", status: "completed" },
    ])
  })

  it("中断工具时保留已经流出来的命令输出", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "做事" }, 1)
    handleTurnEvent(
      tracker,
      { type: "tool.call.started", turnId: 1, toolCallId: "tc", name: "Shell", display: { kind: "command", command: "x" } },
      2,
    )
    handleTurnEvent(tracker, { type: "tool.progress", turnId: 1, toolCallId: "tc", update: { text: "半截输出" } }, 3)
    handleTurnEvent(tracker, { type: "turn.ended", turnId: 1, reason: "cancelled" }, 4)
    const closed = events.findLast((event) => event.type === "item.updated" && event.item.kind === "tool_call")
    expect(closed).toMatchObject({ item: { status: "interrupted", detail: { output: "半截输出" } } })
  })

  it("正常收工仍缺工具结果时明确失败，不留下 running", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    tracker.begin("omni-turn", "做事")
    handleTurnEvent(tracker, { type: "turn.started", turnId: 1, prompt: "做事" }, 1)
    handleTurnEvent(
      tracker,
      { type: "tool.call.started", turnId: 1, toolCallId: "tc", name: "Shell", display: { kind: "command", command: "x" } },
      2,
    )
    handleTurnEvent(tracker, { type: "turn.ended", turnId: 1, reason: "completed" }, 3)
    expect(events.find((event) => event.type === "item.updated")).toMatchObject({
      item: { status: "failed", error: expect.stringContaining("没有报告") },
    })
  })
})
