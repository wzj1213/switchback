import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { KimiTurnEvents } from "./turn-events.js"
import { KimiTurnTracker } from "./turn.js"

const origin = {
  kind: "cron_job",
  jobId: "job-1",
  cron: "7 * * * *",
  recurring: true,
  coalescedCount: 3,
  stale: false,
} as const

describe("Kimi 原生定时轮", () => {
  it("配对原生开始与触发帧，并把后续正文挂到宿主铸造的轮次", () => {
    const events: Event[] = []
    const starts: unknown[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const handler = new KimiTurnEvents(tracker, (turn) => {
      starts.push(turn)
      return "host-turn"
    })

    handler.handle({ type: "turn.started", turnId: 5, origin }, 1)
    handler.handle({ type: "cron.fired", prompt: "检查部署", origin }, 2)
    handler.handle({ type: "assistant.delta", turnId: 5, delta: "完成" }, 3)
    handler.handle({ type: "turn.ended", turnId: 5, reason: "completed" }, 4)

    expect(starts).toEqual([
      {
        at: 1,
        prompt: "检查部署",
        origin: {
          kind: "scheduled",
          taskId: "job-1",
          schedule: "7 * * * *",
          recurring: true,
          coalescedCount: 3,
          stale: false,
        },
      },
    ])
    expect(events).toMatchObject([
      { type: "item.started", item: { turnId: "host-turn", kind: "agent_message", text: "完成" } },
      { type: "item.updated", item: { turnId: "host-turn", complete: true } },
      { type: "turn.completed", turnId: "host-turn", status: "completed" },
    ])
  })

  it("宿主已有别的轮次时不覆盖，也不把孤立触发帧硬猜给当前轮", () => {
    const events: Event[] = []
    const tracker = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 0 })
    const handler = new KimiTurnEvents(tracker, () => undefined)

    handler.handle({ type: "turn.started", turnId: 5, origin }, 1)
    handler.handle({ type: "cron.fired", prompt: "检查部署", origin }, 2)
    handler.handle({ type: "assistant.delta", turnId: 5, delta: "不该出现" }, 3)

    expect(events).toEqual([])
    expect(tracker.hasActive()).toBe(false)
  })

  it("中间丢帧后清掉待配对项，不把后来的触发错绑到旧轮", () => {
    const starts: unknown[] = []
    const tracker = new KimiTurnTracker({ emit: () => undefined, now: () => 0 })
    const handler = new KimiTurnEvents(tracker, (turn) => {
      starts.push(turn)
      return "host-turn"
    })

    handler.handle({ type: "turn.started", turnId: 5, origin }, 1)
    handler.handle({ type: "turn.started", turnId: 6 }, 2)
    handler.handle({ type: "cron.fired", prompt: "旧任务", origin }, 3)

    expect(starts).toEqual([])
    expect(tracker.hasActive()).toBe(false)
  })
})
