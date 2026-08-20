import { describe, expect, it } from "vitest"
import type { EngineDriver, EngineSession, StartRequest } from "@omni/engine"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { Event, Thread, Trust } from "@omni/protocol"
import { createHost } from "./host.js"

function nativeClass(trust: Trust): string {
  return trust
}

function harness(): {
  host: ReturnType<typeof createHost>
  starts: { trust: Trust; resume?: string }[]
  events: Event[]
  disposed: { count: number }
} {
  const starts: { trust: Trust; resume?: string }[] = []
  const events: Event[] = []
  const disposed = { count: 0 }
  const driver: EngineDriver = {
    id: "codex",
    start: (req: StartRequest): Promise<EngineSession> => {
      starts.push({ trust: req.trust, ...(req.resume === undefined ? {} : { resume: req.resume }) })
      req.onHandle?.("native-1")
      return Promise.resolve({
        threadId: req.threadId,
        prompt: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        setTrust: (trust) =>
          Promise.resolve(
            nativeClass(trust) === nativeClass(req.trust)
              ? { restart: false as const }
              : { restart: true as const, detail: "等当前轮结束后重启" },
          ),
        models: () => Promise.resolve([]),
        setModel: () => Promise.resolve({}),
        capabilities: () => NO_CAPABILITIES,
        dispose: () => {
          disposed.count += 1
          return Promise.resolve()
        },
      })
    },
  }
  const ids = { value: 0 }
  const host = createHost({
    drivers: { codex: driver },
    home: "/home/dev",
    emit: (event) => events.push(event),
    newId: (prefix) => {
      ids.value += 1
      return `${prefix}-${String(ids.value)}`
    },
    now: () => ids.value,
  })
  return { host, starts, events, disposed }
}

function threadOf(events: readonly Event[]): Thread {
  const record = [...events]
    .reverse()
    .find(
      (event): event is Extract<Event, { type: "thread.started" | "thread.updated" }> =>
        event.type === "thread.started" || event.type === "thread.updated",
    )
  if (record === undefined) throw new Error("测试没有 thread 事件")
  return record.thread
}

describe("setTrust", () => {
  it("原生沙箱不同就续接同一条会话重启", async () => {
    const h = harness()
    await h.host.dispatch({ type: "thread.create", cwd: "/w", engine: "codex", trust: "auto-edit" })
    const id = threadOf(h.events).id
    await h.host.dispatch({ type: "thread.setTrust", threadId: id, trust: "read-only" })

    expect(h.starts).toEqual([{ trust: "auto-edit" }, { trust: "read-only", resume: "native-1" }])
    expect(h.disposed.count).toBe(1)
    expect(threadOf(h.events)).toMatchObject({
      trust: "read-only",
      trustApply: { result: "applied" },
    })
  })

  it("自动审批到完全访问会续接重启", async () => {
    const h = harness()
    await h.host.dispatch({ type: "thread.create", cwd: "/w", engine: "codex", trust: "auto-edit" })
    await h.host.dispatch({
      type: "thread.setTrust",
      threadId: threadOf(h.events).id,
      trust: "full",
    })
    expect(h.starts).toEqual([{ trust: "auto-edit" }, { trust: "full", resume: "native-1" }])
    expect(h.disposed.count).toBe(1)
    expect(threadOf(h.events).trust).toBe("full")
  })

  it("正在跑时不为换沙箱打断任务，也不先改界面档位", async () => {
    const h = harness()
    await h.host.dispatch({ type: "thread.create", cwd: "/w", engine: "codex", trust: "auto-edit" })
    const id = threadOf(h.events).id
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "继续" })
    await expect(
      h.host.dispatch({ type: "thread.setTrust", threadId: id, trust: "read-only" }),
    ).rejects.toThrow("等当前轮结束")
    expect(h.starts).toHaveLength(1)
    expect(threadOf(h.events).trust).toBe("auto-edit")
  })
})
