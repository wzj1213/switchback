import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver, EngineSession } from "@switchback/engine"
import { createHost } from "./host.js"

const NOTE = "<switchback-handoff>此前由 a 跑了第 1 轮</switchback-handoff>"

/** 握手时就报句柄的那类引擎（codex、Kimi、ACP）；b 的第一句在 prompt 阶段被拒。 */
function rig(): {
  host: ReturnType<typeof createHost>
  events: Event[]
  received: Record<string, string[]>
  emitters: Record<string, (event: Event) => void>
  turns: Record<string, string[]>
  reject: { next: boolean }
} {
  const events: Event[] = []
  const received: Record<string, string[]> = { a: [], b: [] }
  const emitters: Record<string, (event: Event) => void> = {}
  const turns: Record<string, string[]> = { a: [], b: [] }
  const reject = { next: false }
  const make = (id: string): EngineDriver => ({
    id,
    start: (req) => {
      emitters[id] = req.emit
      req.onHandle?.(`${id}-native`)
      const session: EngineSession = {
        threadId: req.threadId,
        prompt: (text, turnId) => {
          turns[id]?.push(turnId)
          if (id === "b" && reject.next) {
            reject.next = false
            return Promise.reject(new Error("Request body is too large"))
          }
          received[id]?.push(text)
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
    handoffBrief: () => Promise.resolve(NOTE),
  })
  return { host, events, received, emitters, turns, reject }
}

describe("换家后第一句被拒", () => {
  it("引擎没收下那句，就不算开过口：重发时照样附交接说明", async () => {
    const r = rig()
    await r.host.dispatch({ type: "thread.create", cwd: "/w", engine: "a", trust: "auto-edit" })
    const id = r.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "把 X 改成 Y" })
    r.emitters["a"]?.({ type: "turn.completed", at: 1, turnId: r.turns["a"]?.[0] ?? "", status: "completed" })
    await r.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })

    r.reject.next = true
    await expect(r.host.dispatch({ type: "thread.prompt", threadId: id, text: "B 接着做" })).rejects.toThrow("Request body is too large")
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "B 接着做" })
    expect(r.received["b"]).toEqual([`${NOTE}\n\nB 接着做`])
    // b 这一段从它真正开口那一轮开始的时刻算起：转录区按时间把内容对到「谁跑的」
    const started = r.events.filter((event) => event.type === "turn.started").at(-1)
    const segments = r.host.live()[0]?.segments ?? []
    expect(segments.map((segment) => segment.engine)).toEqual(["a", "b"])
    expect(segments.at(-1)?.startedAt).toBe(started?.at)
  })
})
