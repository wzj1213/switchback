import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@omni/protocol"
import type { EngineDriver } from "@omni/engine"
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

describe("宿主退出与引擎启动并发", () => {
  it("退出后才握手成功的 session 会自行销毁，不再补发会话事件", async () => {
    const gate = deferred()
    const started = deferred()
    const disposed = { value: false }
    const driver: EngineDriver = {
      id: "fake",
      start: async (req) => {
        started.resolve()
        await gate.promise
        return {
          threadId: req.threadId,
          prompt: () => Promise.resolve(),
          interrupt: () => Promise.resolve(),
          setTrust: () => Promise.resolve({ restart: false }),
          models: () => Promise.resolve([]),
          setModel: () => Promise.resolve({}),
          capabilities: () => NO_CAPABILITIES,
          dispose: () => {
            disposed.value = true
            return Promise.resolve()
          },
        }
      },
    }
    const events: Event[] = []
    const removed: string[] = []
    const ids = { value: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-${String(++ids.value)}`,
      now: () => ids.value,
      removeWorktreeBaseline: (threadId) => {
        removed.push(threadId)
        return Promise.resolve()
      },
    })
    const opening = host.dispatch({
      type: "thread.create",
      cwd: "/w",
      engine: "fake",
      trust: "auto-edit",
    })
    await started.promise
    await host.dispose()
    const count = events.length
    const threadId = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    expect(removed).toEqual([threadId])
    gate.resolve()
    await expect(opening).rejects.toThrow("宿主已经关闭")
    expect(disposed.value).toBe(true)
    expect(host.live()).toEqual([])
    expect(events).toHaveLength(count)
  })
})
