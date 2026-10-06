import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver } from "@switchback/engine"
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

describe("临时会话并发新建", () => {
  it("后一条会取消仍在握手的前一条，迟到 session 自毁且只发一次 removed", async () => {
    const gate = deferred()
    const started = deferred()
    const disposed = { a: false }
    const driver = (id: "a" | "b"): EngineDriver => ({
      id,
      start: async (req) => {
        if (id === "a") {
          started.resolve()
          await gate.promise
        }
        return {
          threadId: req.threadId,
          prompt: () => Promise.resolve(),
          interrupt: () => Promise.resolve(),
          setTrust: () => Promise.resolve({ restart: false }),
          models: () => Promise.resolve([]),
          setModel: () => Promise.resolve({}),
          capabilities: () => NO_CAPABILITIES,
          dispose: () => {
            if (id === "a") disposed.a = true
            return Promise.resolve()
          },
        }
      },
    })
    const events: Event[] = []
    const ids = { value: 0 }
    const host = createHost({
      drivers: { a: driver("a"), b: driver("b") },
      home: "/h",
      emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-${String(++ids.value)}`,
      now: () => ids.value,
    })
    const first = host.dispatch({ type: "thread.create", cwd: "/w", engine: "a", trust: "auto-edit" })
    await started.promise
    const firstId = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.create", cwd: "/w", engine: "b", trust: "auto-edit" })
    gate.resolve()
    // 被后一条新建正常取代，不给界面制造一条伪失败横幅。
    await expect(first).resolves.toBeUndefined()
    expect(disposed.a).toBe(true)
    expect(host.live().map((thread) => thread.engine)).toEqual(["b"])
    expect(
      events.filter((event) => event.type === "thread.removed" && event.threadId === firstId),
    ).toHaveLength(1)
  })
})
