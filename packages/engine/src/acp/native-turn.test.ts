import { describe, expect, it } from "vitest"
import type { ForeignTurn } from "./caps.js"
import { AcpNativeTurnQueue } from "./native-turn.js"

const turn = (key: string): ForeignTurn => ({ key, prompt: `run ${key}` })

describe("ACP 原生主动轮队列", () => {
  it("宿主忙时保留 FIFO，同一在途触发去重，收工后允许下一次同任务触发", () => {
    let busy = true
    let seq = 0
    const starts: unknown[] = []
    const sent: { key: string; turnId: string }[] = []
    const queue = new AcpNativeTurnQueue({
      now: () => 42,
      begin: (request) => {
        if (busy) return undefined
        starts.push(request)
        seq += 1
        return `turn-${String(seq)}`
      },
      send: (request, turnId) => sent.push({ key: request.key, turnId }),
    })

    expect(queue.enqueue(turn("a"))).toBe(true)
    expect(queue.enqueue(turn("a"))).toBe(false)
    expect(queue.enqueue(turn("b"))).toBe(true)
    expect(sent).toEqual([])

    busy = false
    queue.poke()
    expect(sent).toEqual([{ key: "a", turnId: "turn-1" }])
    queue.settled("stale-turn")
    expect(sent).toHaveLength(1)
    queue.settled("turn-1")
    expect(sent).toEqual([
      { key: "a", turnId: "turn-1" },
      { key: "b", turnId: "turn-2" },
    ])
    queue.settled("turn-2")
    expect(queue.enqueue(turn("a"))).toBe(true)
    expect(starts).toEqual([
      { at: 42, prompt: "run a" },
      { at: 42, prompt: "run b" },
      { at: 42, prompt: "run a" },
    ])
  })

  it("把引擎上报的结构化来源原样交给宿主", () => {
    const starts: unknown[] = []
    const scheduled: ForeignTurn = {
      key: "job",
      prompt: "check deploy",
      origin: {
        kind: "scheduled",
        taskId: "job",
        schedule: "every minute",
        recurring: true,
        coalescedCount: 1,
        stale: false,
      },
    }
    const queue = new AcpNativeTurnQueue({
      now: () => 7,
      begin: (request) => {
        starts.push(request)
        return "native-turn"
      },
      send: () => undefined,
    })
    queue.enqueue(scheduled)
    expect(starts).toEqual([{ at: 7, prompt: "check deploy", origin: scheduled.origin }])
  })
})
