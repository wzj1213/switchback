import { describe, expect, it } from "vitest"
import type { EngineDriver, EngineSession, StartRequest } from "@switchback/engine"
import { NO_CAPABILITIES } from "@switchback/protocol"
import type { Event, Thread, Trust } from "@switchback/protocol"
import { createHost } from "./host.js"

function nativeClass(trust: Trust): string {
  return trust
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const slot: { resolve?: () => void } = {}
  return {
    promise: new Promise((resolve) => {
      slot.resolve = resolve
    }),
    resolve: () => slot.resolve?.(),
  }
}

function harness(restartGate?: Promise<void>, failStarts: ReadonlySet<number> = new Set()): {
  host: ReturnType<typeof createHost>
  starts: { trust: Trust; resume?: string }[]
  events: Event[]
  disposed: { count: number }
  prompts: string[]
} {
  const starts: { trust: Trust; resume?: string }[] = []
  const events: Event[] = []
  const disposed = { count: 0 }
  const prompts: string[] = []
  const driver: EngineDriver = {
    id: "codex",
    start: async (req: StartRequest): Promise<EngineSession> => {
      starts.push({ trust: req.trust, ...(req.resume === undefined ? {} : { resume: req.resume }) })
      if (starts.length > 1) await restartGate
      if (failStarts.has(starts.length)) throw new Error(`start ${String(starts.length)} failed`)
      req.onHandle?.("native-1")
      return {
        threadId: req.threadId,
        prompt: (text) => {
          prompts.push(text)
          return Promise.resolve()
        },
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
      }
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
  return { host, starts, events, disposed, prompts }
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

  it("权限重启握手期间的输入会排队，接好后自动送达", async () => {
    const gate = deferred()
    const h = harness(gate.promise)
    await h.host.dispatch({ type: "thread.create", cwd: "/w", engine: "codex", trust: "auto-edit" })
    const id = threadOf(h.events).id
    const changing = h.host.dispatch({ type: "thread.setTrust", threadId: id, trust: "read-only" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.host.live()[0]?.status).toBe("starting")
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "重启期间别丢" })
    expect(h.host.live()[0]?.queued).toEqual(["重启期间别丢"])
    gate.resolve()
    await changing
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.prompts).toEqual(["重启期间别丢"])
    expect(h.host.live()[0]?.queued).toEqual([])
  })

  it("新档位与旧档位都重连失败时，握手期间取回的草稿仍留在历史壳", async () => {
    const gate = deferred()
    const h = harness(gate.promise, new Set([2, 3]))
    await h.host.dispatch({ type: "thread.create", cwd: "/w", engine: "codex", trust: "auto-edit" })
    const id = threadOf(h.events).id
    const changing = h.host.dispatch({ type: "thread.setTrust", threadId: id, trust: "read-only" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await h.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "失败也要取回",
      attachments: ["/tmp/restart-draft.png"],
    })
    await h.host.dispatch({ type: "thread.unqueue", threadId: id })
    gate.resolve()

    await expect(changing).rejects.toThrow("start 2 failed")
    expect(threadOf(h.events)).toMatchObject({
      detached: true,
      status: "failed",
      draft: "失败也要取回",
      draftAttachments: ["/tmp/restart-draft.png"],
      draftRevision: expect.stringMatching(/^dr/),
    })
  })
})
