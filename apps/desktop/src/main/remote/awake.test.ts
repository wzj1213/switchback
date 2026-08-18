import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Event } from "@omni/protocol"

/** `powerSaveBlocker` 的账：谁被起过、谁被停过。 */
const blockers = { started: [] as string[], stopped: [] as number[], next: 100 }

vi.mock("electron", () => ({
  powerSaveBlocker: {
    start: (kind: string) => {
      blockers.started.push(kind)
      blockers.next += 1
      return blockers.next
    },
    stop: (id: number) => {
      blockers.stopped.push(id)
    },
  },
}))

const { createAwake } = await import("./awake.js")

const log = { write: () => undefined, file: "" }

const started = (id: string): Event => ({
  type: "turn.started",
  at: 0,
  turn: { id, threadId: "t", engine: "codex", status: "running", startedAt: 0 },
})
const done = (id: string): Event => ({ type: "turn.completed", at: 0, turnId: id, status: "completed" })

beforeEach(() => {
  blockers.started = []
  blockers.stopped = []
})

describe("有活在跑就别睡", () => {
  it("一轮起来就挡，跑完就放", () => {
    const awake = createAwake(log, () => true)
    awake.note(started("u1"))
    expect(blockers.started).toEqual(["prevent-app-suspension"])
    awake.note(done("u1"))
    expect(blockers.stopped).toHaveLength(1)
  })

  it("**几轮同时跑只挡一次，全跑完才放**", () => {
    const awake = createAwake(log, () => true)
    awake.note(started("u1"))
    awake.note(started("u2"))
    expect(blockers.started).toHaveLength(1)
    awake.note(done("u1"))
    expect(blockers.stopped).toHaveLength(0)
    awake.note(done("u2"))
    expect(blockers.stopped).toHaveLength(1)
  })

  it("**远程没开就不挡**——一直挡着等于把这台机器的电池管理关掉", () => {
    const awake = createAwake(log, () => false)
    awake.note(started("u1"))
    expect(blockers.started).toEqual([])
  })

  it("开关是现读的：开着的时候起的那一轮才挡", () => {
    const on = { value: false }
    const awake = createAwake(log, () => on.value)
    awake.note(started("u1"))
    expect(blockers.started).toEqual([])
    on.value = true
    awake.note(started("u2"))
    expect(blockers.started).toHaveLength(1)
  })

  it("**退出前放开**——否则那个 blocker 跟着进程一起消失得不明不白", () => {
    const awake = createAwake(log, () => true)
    awake.note(started("u1"))
    awake.release()
    expect(blockers.stopped).toHaveLength(1)
    // 再放一次不该重复停
    awake.release()
    expect(blockers.stopped).toHaveLength(1)
  })

  it("没挡过就放，什么都不做", () => {
    createAwake(log, () => true).release()
    expect(blockers.stopped).toEqual([])
  })

  it("别的事件一概不管", () => {
    const awake = createAwake(log, () => true)
    awake.note({ type: "item.delta", at: 0, itemId: "i", append: "x" })
    expect(blockers.started).toEqual([])
  })
})
