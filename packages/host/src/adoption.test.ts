import { describe, expect, it } from "vitest"
import type { EngineDriver, EngineSession } from "@switchback/engine"
import { NO_CAPABILITIES, type EngineAxis, type Event, type Item } from "@switchback/protocol"
import { createHost } from "./host.js"

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  const slot: { resolve?: (value: T) => void } = {}
  const promise = new Promise<T>((resolve) => { slot.resolve = resolve })
  return { promise, resolve: (value) => { slot.resolve?.(value) } }
}

describe("接管原生会话", () => {
  it("撤掉界面条目，也删除已经写下的日志与工作树基线", async () => {
    const events: Event[] = []
    const removed = { journal: [] as string[], baseline: [] as string[] }
    const driver: EngineDriver = {
      id: "bad",
      start: () => Promise.reject(new Error("resume failed")),
    }
    const host = createHost({
      drivers: { bad: driver },
      home: "/h",
      emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-adopt`,
      now: () => 1,
      journal: {
        append: () => Promise.resolve(),
        read: () => Promise.resolve([]),
        list: () => Promise.resolve([]),
        flush: () => Promise.resolve(),
        remove: (threadId) => {
          removed.journal.push(threadId)
          return Promise.resolve()
        },
      },
      removeWorktreeBaseline: (threadId) => {
        removed.baseline.push(threadId)
        return Promise.resolve()
      },
    })

    await expect(host.dispatch({
      type: "thread.adopt",
      engine: "bad",
      handle: "native-1",
      cwd: "/w",
      title: "原生记录",
    })).rejects.toThrow("resume failed")
    expect(removed).toEqual({ journal: ["th-adopt"], baseline: ["th-adopt"] })
    expect(events.filter((event) => event.type === "thread.removed")).toHaveLength(1)
  })

  it("成功接管会把宿主真源落成 idle，迟到的原生状态不会改回 starting", async () => {
    const events: Event[] = []
    const signal: { report?: (patch: { axes?: readonly EngineAxis[]; modelId?: string }) => void } = {}
    const driver: EngineDriver = {
      id: "ok",
      start: (request) => {
        signal.report = request.onEngineState
        request.onHandle?.("canonical-2")
        return Promise.resolve({
          threadId: request.threadId,
          prompt: () => Promise.resolve(),
          interrupt: () => Promise.resolve(),
          setTrust: () => Promise.resolve({ restart: false }),
          models: () => Promise.resolve([]),
          capabilities: () => NO_CAPABILITIES,
          setModel: () => Promise.resolve({}),
          dispose: () => Promise.resolve(),
        } as EngineSession)
      },
    }
    const host = createHost({
      drivers: { ok: driver },
      home: "/h",
      emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-adopted`,
      now: () => 2,
    })

    await host.dispatch({
      type: "thread.adopt",
      engine: "ok",
      handle: "native-2",
      cwd: "/w",
      title: "已接管",
    })
    signal.report?.({ modelId: "late-model" })

    expect(host.live()[0]).toMatchObject({
      status: "idle",
      engineHandle: "canonical-2",
      engineState: { modelId: "late-model" },
    })
    expect(events.filter((event) => event.type === "thread.updated").at(-1)?.thread.status).toBe("idle")
  })

  it("原生历史搬完之前保持 starting，继承记录排在开放输入之前", async () => {
    const events: Event[] = []
    const history = deferred<{ items: readonly Item[]; total: number }>()
    const reading = deferred<undefined>()
    const sent = deferred<undefined>()
    const prompts: string[] = []
    const driver: EngineDriver = {
      id: "slow",
      start: (request) => Promise.resolve({
        threadId: request.threadId,
        activate: () => {
          const turnId = request.onNativeTurn?.({
            at: 2,
            prompt: "定时检查",
            origin: { kind: "scheduled", taskId: "job", schedule: "* * * * *",
              recurring: true, coalescedCount: 1, stale: false },
          })
          if (turnId !== undefined) {
            request.emit({ type: "turn.completed", at: 2, turnId, status: "completed" })
          }
          return Promise.resolve()
        },
        prompt: (text: string) => { prompts.push(text); sent.resolve(undefined); return Promise.resolve() },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }), models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES, setModel: () => Promise.resolve({}),
        transcript: () => { reading.resolve(undefined); return history.promise },
        dispose: () => Promise.resolve(),
      } as EngineSession),
    }
    const host = createHost({ drivers: { slow: driver }, home: "/h", emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-${String(events.length)}`, now: () => 3 })
    const opening = host.dispatch({ type: "thread.adopt", engine: "slow", handle: "native-3",
      cwd: "/w", title: "慢历史" })
    await reading.promise
    const threadId = host.live()[0]?.id
    expect(threadId).toBeDefined()
    expect(host.live()[0]?.status).toBe("starting")
    expect(events.some((event) => event.type === "thread.updated" && event.thread.status === "idle")).toBe(false)
    await host.dispatch({ type: "thread.prompt", threadId: threadId ?? "", text: "历史之后的新消息" })
    expect(host.live()[0]?.queued).toEqual(["历史之后的新消息"])
    expect(prompts).toEqual([])
    history.resolve({ items: [{ id: "old", turnId: "native-turn", kind: "user_message", at: 1,
      text: "旧消息" }], total: 1 })
    await opening
    await sent.promise
    const copied = events.findIndex((event) => event.type === "item.started" && event.item.inherited === true)
    const native = events.findIndex((event) => event.type === "item.started" &&
      event.item.kind === "user_message" && event.item.origin !== undefined)
    const ready = events.findIndex((event) => event.type === "thread.updated" && event.thread.status === "idle")
    const fresh = events.findIndex((event) => event.type === "item.started" &&
      event.item.kind === "user_message" && event.item.text === "历史之后的新消息")
    expect(copied).toBeGreaterThan(-1)
    expect(native).toBeGreaterThan(copied)
    expect(ready).toBeGreaterThan(native)
    expect(fresh).toBeGreaterThan(ready)
    expect(prompts).toEqual(["历史之后的新消息"])
  })
})
