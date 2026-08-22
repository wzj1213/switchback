import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@omni/protocol"
import type { EngineDriver, StartRequest } from "@omni/engine"
import { createHost } from "./host.js"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const slot: { resolve?: () => void } = {}
  return {
    promise: new Promise((resolve) => {
      slot.resolve = resolve
    }),
    resolve: () => slot.resolve?.(),
  }
}

describe("改向的迟到结果", () => {
  it("删除会话后旧 steer 成功回包也不能重建 item 或日志事件", async () => {
    const gate = deferred()
    const events: Event[] = []
    const driver: EngineDriver = {
      id: "fake",
      start: (req: StartRequest) => Promise.resolve({
        threadId: req.threadId,
        prompt: () => Promise.resolve(),
        steer: () => gate.promise,
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        setModel: () => Promise.resolve({}),
        capabilities: () => ({ ...NO_CAPABILITIES, steer: true }),
        dispose: () => Promise.resolve(),
      }),
    }
    const ids = { value: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-${String(++ids.value)}`,
      now: () => ids.value,
    })
    await host.dispatch({ type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" })
    const threadId = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "先跑着" })
    const steering = host.dispatch({ type: "thread.prompt", threadId, text: "改方向", steer: true })
    await Promise.resolve()
    await host.dispatch({ type: "thread.delete", threadId })
    const removedAt = events.findLastIndex((event) => event.type === "thread.removed")
    gate.resolve()
    await steering
    expect(events.slice(removedAt + 1)).toEqual([])
  })
})
