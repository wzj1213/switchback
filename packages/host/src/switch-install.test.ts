import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver, EngineSession } from "@switchback/engine"
import { createHost } from "./host.js"

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** b 像 Kimi：登记之后还要 activate（连实时流）才算装好，由测试放行。 */
function rig() {
  const events: Event[] = []
  const received: Record<string, string[]> = { a: [], b: [] }
  const turns: Record<string, string[]> = { a: [], b: [] }
  const emitters: Record<string, (event: Event) => void> = {}
  const gate: { open?: () => void } = {}
  const make = (id: string): EngineDriver => ({
    id,
    start: (req) => {
      emitters[id] = req.emit
      req.onHandle?.(`${id}-native`)
      const session: EngineSession = {
        threadId: req.threadId,
        ...(id === "b" ? { activate: () => new Promise<void>((resolve) => { gate.open = resolve }) } : {}),
        prompt: (text, turnId) => {
          received[id]?.push(text)
          turns[id]?.push(turnId)
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      }
      return Promise.resolve(session)
    },
  })
  const counter = { n: 0 }
  const host = createHost({
    drivers: { a: make("a"), b: make("b") },
    home: "/h",
    emit: (event) => events.push(event),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => counter.n,
  })
  return { host, events, received, turns, emitters, gate }
}

describe("换引擎装到一半时取回", () => {
  it("等这次切换做完再取：撤回的那句不会被装好时的旧队列盖回来、再发出去", async () => {
    const r = rig()
    await r.host.dispatch({ type: "thread.create", cwd: "/w", engine: "a", trust: "auto-edit" })
    const id = r.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "A 的一轮" })
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队1" })
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队2" })
    await r.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    r.emitters["a"]?.({ type: "turn.completed", at: 1, turnId: r.turns["a"]?.[0] ?? "", status: "completed" })
    await tick()

    const taking = r.host.dispatch({ type: "thread.unqueue", threadId: id, index: 1 })
    r.gate.open?.()
    await taking
    await tick()
    expect(r.host.live()[0]).toMatchObject({ engine: "b", queued: [], draft: "排队2" })
    r.emitters["b"]?.({ type: "turn.completed", at: 2, turnId: r.turns["b"]?.[0] ?? "", status: "completed" })
    await tick()
    expect(r.received["b"]).toEqual(["排队1"])
  })
})
