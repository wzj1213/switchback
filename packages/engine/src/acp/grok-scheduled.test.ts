import { describe, expect, it } from "vitest"
import { grokScheduledTurn } from "./grok-scheduled.js"

const payload = {
  sessionId: "session-1",
  taskId: "task-1",
  prompt: "检查部署",
  humanSchedule: "every 5 minutes",
  nextFireAt: "2026-08-25T12:00:00Z",
}

describe("Grok 前台定时任务", () => {
  it("兼容直达与 leader 包装，只采用引擎给出的任务原文和计划", () => {
    const expected = {
      key: "grok-scheduled:task-1",
      prompt: "检查部署",
      origin: {
        kind: "scheduled",
        taskId: "task-1",
        schedule: "every 5 minutes",
        recurring: true,
        coalescedCount: 1,
        stale: false,
      },
    }
    const direct = grokScheduledTurn("x.ai/scheduled_task_inject_prompt", payload)
    const prefixed = grokScheduledTurn("_x.ai/scheduled_task_inject_prompt", payload)
    const wrapped = grokScheduledTurn("_x.ai/scheduled_task_inject_prompt", {
      method: "x.ai/scheduled_task_inject_prompt",
      params: payload,
    })
    expect(direct).toMatchObject(expected)
    expect(prefixed).toMatchObject(expected)
    expect(wrapped).toMatchObject(expected)
    expect(direct?.promptMeta?.("host-turn")).toEqual({ promptId: "scheduler-fired-host-turn" })
  })

  it("缺任务、正文或计划时不猜一轮，其他私有方法也不误认", () => {
    expect(grokScheduledTurn("_x.ai/other", payload)).toBeUndefined()
    for (const field of ["taskId", "prompt", "humanSchedule"] as const) {
      expect(
        grokScheduledTurn("x.ai/scheduled_task_inject_prompt", { ...payload, [field]: "" }),
      ).toBeUndefined()
    }
    expect(
      grokScheduledTurn("_x.ai/scheduled_task_inject_prompt", {
        method: "x.ai/not-the-scheduler",
        params: payload,
      }),
    ).toBeUndefined()
  })
})
