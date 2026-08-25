import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@omni/protocol"
import { reduceAll } from "./reduce.js"
import { initial, thinkingTokensOf } from "./state.js"

const thread: Thread = {
  id: "th-1",
  title: "测试",
  cwd: "/w",
  engine: "claude",
  trust: "auto-edit",
  status: "running",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["claude"],
}

const start = (turnId: string): Event => ({
  type: "turn.started",
  at: 0,
  turn: { id: turnId, threadId: thread.id, engine: "claude", status: "running", startedAt: 0 },
})

const progress = (turnId: string, estimatedTokens?: number): Event => ({
  type: "thinking.updated",
  at: 1,
  threadId: thread.id,
  turnId,
  ...(estimatedTokens === undefined ? {} : { estimatedTokens }),
})

describe("思考 token 活状态", () => {
  it("只认当前轮，并在清空、收工、换轮与删会话时回收", () => {
    const born: Event = { type: "thread.started", at: 0, thread }
    const cases: readonly { name: string; events: readonly Event[]; want: number | undefined }[] = [
      { name: "当前轮更新", events: [start("tu-1"), progress("tu-1", 42)], want: 42 },
      { name: "显式清空", events: [start("tu-1"), progress("tu-1", 42), progress("tu-1")], want: undefined },
      { name: "旧轮迟到", events: [start("tu-1"), progress("old", 42)], want: undefined },
      {
        name: "轮次收工",
        events: [start("tu-1"), progress("tu-1", 42), {
          type: "turn.completed", at: 2, turnId: "tu-1", status: "completed",
        }],
        want: undefined,
      },
      { name: "新轮出生", events: [start("tu-1"), progress("tu-1", 42), start("tu-2")], want: undefined },
      {
        name: "删会话",
        events: [start("tu-1"), progress("tu-1", 42), { type: "thread.removed", at: 2, threadId: "th-1" }],
        want: undefined,
      },
    ]

    for (const one of cases) {
      const state = reduceAll(initial(), [born, ...one.events])
      expect(thinkingTokensOf(state, thread.id), one.name).toBe(one.want)
    }
  })
})
