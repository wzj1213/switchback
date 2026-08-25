import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { KimiApi } from "./http.js"
import { KimiTurnEvents } from "./turn-events.js"
import { reconcileKimiTurn } from "./turn-recovery.js"
import { KimiTurnTracker } from "./turn.js"
import type { KimiSnapshot, KimiTranscriptPage } from "./wire.js"

const cronOrigin = {
  kind: "cron_job",
  jobId: "job-1",
  cron: "7 * * * *",
  recurring: true,
  coalescedCount: 2,
  stale: false,
} as const

function runningSnapshot(): KimiSnapshot {
  return {
    as_of_seq: 21,
    epoch: "ep2",
    session: {
      id: "s1",
      title: "",
      busy: true,
      metadata: { cwd: "/work" },
      agent_config: { model: "k2" },
    },
    in_flight_turn: {
      turn_id: 5,
      assistant_text: "已检查",
      thinking_text: "",
      running_tools: [],
    },
    pending_approvals: [],
    pending_questions: [],
  }
}

describe("Kimi 原生轮重同步", () => {
  it("从公开 transcript 精确补回丢失的 cron 开始帧，再接上快照正文", async () => {
    const events: Event[] = []
    const starts: unknown[] = []
    const paths: string[] = []
    const page: KimiTranscriptPage = {
      has_more: true,
      items: [
        {
          kind: "turn",
          turnId: "t5",
          state: "running",
          origin: { kind: "cron", taskId: "job-1", payload: cronOrigin },
          prompt: '<cron-fire job-id="job-1">\n<prompt>\n检查部署\n</prompt>\n</cron-fire>',
          startedAt: "2026-08-25T01:02:03.000Z",
          steps: [],
        },
      ],
    }
    const api: KimiApi = {
      get: <T>(path: string) => {
        paths.push(path)
        return Promise.resolve(page as T)
      },
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const turnEvents = new KimiTurnEvents(tracker, (turn) => {
      starts.push(turn)
      return "host-turn"
    })

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
      runningSnapshot(),
    )

    expect(paths).toEqual(["sessions/s1/transcript?agent_id=main&page_size=10"])
    expect(starts).toEqual([
      {
        at: Date.parse("2026-08-25T01:02:03.000Z"),
        prompt: "检查部署",
        origin: {
          kind: "scheduled",
          taskId: "job-1",
          schedule: "7 * * * *",
          recurring: true,
          coalescedCount: 2,
          stale: false,
        },
      },
    ])
    expect(events).toMatchObject([
      {
        type: "item.started",
        item: { turnId: "host-turn", kind: "agent_message", text: "已检查" },
      },
    ])
  })

  it("断线期间原生用户轮已经开始时，从公开 transcript 建立宿主主线", async () => {
    const events: Event[] = []
    const starts: unknown[] = []
    const page: KimiTranscriptPage = {
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t5",
          state: "running",
          origin: { kind: "user", payload: { kind: "user" } },
          prompt: "原生端已经开始",
          startedAt: "2026-08-25T01:02:03.000Z",
          steps: [],
        },
      ],
    }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const turnEvents = new KimiTurnEvents(tracker, (turn) => {
      starts.push(turn)
      return "host-native"
    })

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
      runningSnapshot(),
    )

    expect(starts).toEqual([
      { at: Date.parse("2026-08-25T01:02:03.000Z"), prompt: "原生端已经开始" },
    ])
    expect(events).toMatchObject([
      {
        type: "item.started",
        item: { turnId: "host-native", kind: "agent_message", text: "已检查" },
      },
    ])
  })

  it("断线跨过目标续轮边界时，按精确原生 id 续在同一宿主轮", async () => {
    const events: Event[] = []
    const starts: unknown[] = []
    const page: KimiTranscriptPage = {
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t5",
          state: "running",
          origin: {
            kind: "other",
            payload: { kind: "system_trigger", name: "goal_continuation" },
          },
          startedAt: "2026-08-25T01:02:03.000Z",
          steps: [],
        },
      ],
    }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const turnEvents = new KimiTurnEvents(
      tracker,
      (turn) => {
        starts.push(turn)
        return "wrong-new-turn"
      },
      () => true,
    )
    tracker.begin("host-goal", "开始长期目标")
    turnEvents.handle({ type: "turn.started", turnId: 4, prompt: "开始长期目标" }, 1)
    turnEvents.handle({ type: "turn.ended", turnId: 4, reason: "completed" }, 2)

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
      runningSnapshot(),
    )

    expect(starts).toEqual([])
    expect(tracker.currentNative()).toBe(5)
    expect(events).toMatchObject([
      {
        type: "item.started",
        item: { turnId: "host-goal", text: "", origin: { kind: "goal_continuation" } },
      },
      {
        type: "item.started",
        item: { turnId: "host-goal", kind: "agent_message", text: "已检查" },
      },
    ])
    expect(events.some((event) => event.type === "turn.completed")).toBe(false)
  })

  it("目标续轮间隙的空闲快照不重放刚结束的原生轮", async () => {
    const events: Event[] = []
    const page: KimiTranscriptPage = {
      has_more: false,
      items: [{ kind: "turn", turnId: "t4", state: "completed", prompt: "开始目标", steps: [] }],
    }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const turnEvents = new KimiTurnEvents(tracker, undefined, () => true)
    tracker.begin("host-goal", "开始目标")
    turnEvents.handle({ type: "turn.started", turnId: 4, prompt: "开始目标" }, 1)
    turnEvents.handle({ type: "turn.ended", turnId: 4, reason: "completed" }, 2)
    const before = events.length
    const idle = {
      ...runningSnapshot(),
      session: { ...runningSnapshot().session, busy: false },
      in_flight_turn: null,
    }

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
      idle,
    )

    expect(events).toHaveLength(before)
    expect(tracker.isAwaitingContinuation()).toBe(true)
  })

  it("最近 transcript 没有匹配轮次时不改绑当前宿主轮", async () => {
    const page: KimiTranscriptPage = { has_more: false, items: [] }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: () => undefined, now: () => 9 })
    tracker.begin("host-turn", "人工请求")
    const turnEvents = new KimiTurnEvents(tracker, () => "wrong-turn")

    await expect(
      reconcileKimiTurn(
        { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
        runningSnapshot(),
      ),
    ).resolves.toBeUndefined()
    expect(tracker.hasActive()).toBe(true)
  })

  it("轮次在断线期间结束时从公开 transcript 补齐各 step、工具和最终正文", async () => {
    const events: Event[] = []
    const page: KimiTranscriptPage = {
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t5",
          state: "completed",
          prompt: "人工请求",
          steps: [
            {
              ordinal: 1,
              state: "completed",
              finishReason: "tool_calls",
              frames: [
                { kind: "text", frameId: "a1", role: "assistant", text: "开头补齐" },
                {
                  kind: "tool",
                  frameId: "tool-frame",
                  toolCallId: "tc1",
                  name: "Shell",
                  state: "done",
                  input: { command: "pwd" },
                  output: "/work",
                  display: { kind: "command", command: "pwd" },
                },
              ],
            },
            {
              ordinal: 2,
              state: "completed",
              finishReason: "completed",
              frames: [{ kind: "text", frameId: "a2", role: "assistant", text: "最终答复" }],
            },
          ],
        },
      ],
    }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const generation = tracker.begin("host-turn", "人工请求")
    tracker.promptAccepted(generation, "prompt-1")
    const turnEvents = new KimiTurnEvents(tracker, () => "wrong-turn")
    turnEvents.handle({ type: "turn.started", turnId: 5, prompt: "人工请求" }, 1)
    turnEvents.handle({ type: "turn.step.started", turnId: 5, step: 1 }, 2)
    turnEvents.handle({ type: "assistant.delta", turnId: 5, delta: "开头" }, 3, 0)
    const idle = {
      ...runningSnapshot(),
      session: {
        ...runningSnapshot().session,
        busy: false,
        last_turn_reason: "completed" as const,
      },
      in_flight_turn: null,
    }

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
      idle,
    )

    expect(events.filter((event) => event.type === "item.delta")).toContainEqual({
      type: "item.delta",
      at: 8,
      itemId: "kimi-answer-host-turn",
      append: "补齐",
    })
    expect(
      events.flatMap((event) => (event.type === "item.started" ? [event.item] : [])),
    ).toMatchObject([
      { kind: "agent_message", text: "开头" },
      { kind: "tool_call", id: "tc1", status: "running" },
      { kind: "agent_message", text: "最终答复" },
    ])
    expect(events.at(-1)).toEqual({
      type: "turn.completed",
      at: 8,
      turnId: "host-turn",
      status: "completed",
    })
    expect(tracker.hasActive()).toBe(false)
  })

  it("断线跨过 step 中断时从公开结论恢复原生提示", async () => {
    const events: Event[] = []
    const page: KimiTranscriptPage = {
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t5",
          state: "cancelled",
          prompt: "人工请求",
          steps: [
            {
              ordinal: 1,
              state: "interrupted",
              endReason: "aborted",
              frames: [{ kind: "text", frameId: "a1", role: "assistant", text: "半截回答" }],
            },
          ],
        },
      ],
    }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    tracker.begin("host-turn", "人工请求")
    const turnEvents = new KimiTurnEvents(tracker, undefined)
    turnEvents.handle({ type: "turn.started", turnId: 5, prompt: "人工请求" }, 1)
    const idle = {
      ...runningSnapshot(),
      session: {
        ...runningSnapshot().session,
        busy: false,
        last_turn_reason: "cancelled" as const,
      },
      in_flight_turn: null,
    }

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 8 },
      idle,
    )

    expect(events.filter((event) => event.type === "item.started")).toMatchObject([
      { type: "item.started", item: { kind: "agent_message", text: "半截回答" } },
      {
        type: "item.started",
        item: { kind: "error", message: "Interrupted by user", fatal: false },
      },
    ])
    expect(events.at(-1)).toEqual({
      type: "turn.completed",
      at: 8,
      turnId: "host-turn",
      status: "interrupted",
    })
  })

  it("尚未拿到原生 turn id 时不会把更早的同文提示误认成当前轮", async () => {
    const events: Event[] = []
    const page: KimiTranscriptPage = {
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t4",
          state: "completed",
          prompt: "重复问题",
          startedAt: "1970-01-01T00:00:00.500Z",
          steps: [
            { frames: [{ kind: "text", frameId: "old", role: "assistant", text: "旧答案" }] },
          ],
        },
      ],
    }
    const api: KimiApi = {
      get: <T>() => Promise.resolve(page as T),
      post: <T>() => Promise.resolve(undefined as T),
    }
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 1_000 })
    const generation = tracker.begin("host-turn", "重复问题")
    tracker.promptAccepted(generation, "new-prompt")
    const turnEvents = new KimiTurnEvents(tracker, () => "wrong-turn")
    const idle = {
      ...runningSnapshot(),
      session: {
        ...runningSnapshot().session,
        busy: false,
        last_turn_reason: "completed" as const,
      },
      in_flight_turn: null,
    }

    await reconcileKimiTurn(
      { api, sessionId: "s1", events: turnEvents, tracker, now: () => 1_001 },
      idle,
    )

    expect(events).toEqual([
      { type: "turn.completed", at: 1_000, turnId: "host-turn", status: "completed" },
    ])
  })
})
